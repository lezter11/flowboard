/**
 * Foreground polling scheduler. Pure (timers and clocks are injected) so it can be tested with fake timers.
 * One tick = one `run()`. Runs every ~15 s (+-20% jitter) while the tab is visible, backs off x2 up to 2 min after
 * failures, resets on success, and stops for good when `run` reports the session ended.
 */
export type TickResult = 'ok' | 'failed' | 'signedOut';

export interface PollerOptions {
  run: () => Promise<TickResult>;
  isVisible: () => boolean;
  /** True while something (a drag, a save in flight) must not be disturbed; the tick is retried shortly. */
  isHeld?: () => boolean;
  intervalMs?: number;
  jitter?: number;
  maxBackoffMs?: number;
  /** Minimum gap between two runs, so focus + visibility events firing together cause one refetch. */
  minGapMs?: number;
  random?: () => number;
  now?: () => number;
  onChange?: (state: PollerState) => void;
}

export interface PollerState {
  /** Epoch ms of the last successful tick, or null before the first. */
  lastSuccessAt: number | null;
  /** Consecutive failed ticks. */
  failures: number;
  stopped: boolean;
}

export const POLL_INTERVAL_MS = 15_000;
export const POLL_MAX_BACKOFF_MS = 120_000;

/** Delay before the next tick: interval x2^failures (capped), with +-jitter around it. */
export function nextDelay(failures: number, opts: { intervalMs: number; jitter: number; maxBackoffMs: number; random: () => number }): number {
  const base = Math.min(opts.intervalMs * 2 ** failures, opts.maxBackoffMs);
  const spread = 1 + (opts.random() * 2 - 1) * opts.jitter;
  return Math.round(base * spread);
}

export function createPoller(options: PollerOptions) {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const jitter = options.jitter ?? 0.2;
  const maxBackoffMs = options.maxBackoffMs ?? POLL_MAX_BACKOFF_MS;
  const minGapMs = options.minGapMs ?? 1000;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  const state: PollerState = { lastSuccessAt: null, failures: 0, stopped: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let started = false;
  let lastRunAt = -Infinity;

  const emit = () => options.onChange?.({ ...state });
  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  const schedule = (ms: number) => {
    clear();
    if (state.stopped || !started) return;
    timer = setTimeout(tick, ms);
  };

  async function tick() {
    timer = null;
    if (state.stopped || !started || running) return;
    // Hidden tab: do nothing now; the visibility handler restarts polling.
    if (!options.isVisible()) return;
    if (options.isHeld?.()) { schedule(1000); return; }
    running = true;
    lastRunAt = now();
    let result: TickResult;
    try { result = await options.run(); } catch { result = 'failed'; }
    running = false;
    if (state.stopped || !started) return;
    if (result === 'signedOut') { state.stopped = true; emit(); return; }
    if (result === 'ok') { state.failures = 0; state.lastSuccessAt = now(); } else state.failures += 1;
    emit();
    schedule(nextDelay(state.failures, { intervalMs, jitter, maxBackoffMs, random }));
  }

  return {
    get state(): PollerState { return { ...state }; },
    start() { if (started || state.stopped) return; started = true; schedule(nextDelay(0, { intervalMs, jitter, maxBackoffMs, random })); },
    stop() { started = false; clear(); },
    /** Run soon (visibility, focus, after the user's own save). Respects the minimum gap and a hidden tab. */
    poke(delayMs = 0) {
      if (state.stopped || !started || running) return;
      if (!options.isVisible()) return;
      const wait = Math.max(delayMs, lastRunAt + minGapMs - now(), 0);
      schedule(wait);
    },
    /** The tab was hidden: stop the timer so nothing runs in the background. */
    pause() { clear(); },
    /** Marks a tick result that happened outside the scheduler (e.g. a manual refresh). */
    reset() { state.stopped = false; state.failures = 0; emit(); },
  };
}

/** "Updated just now" / "Updated 12s ago" / "Updated 3 min ago". */
export function describeAge(lastSuccessAt: number | null, nowMs: number): string {
  if (lastSuccessAt === null) return '';
  const s = Math.max(0, Math.round((nowMs - lastSuccessAt) / 1000));
  if (s < 5) return 'Updated just now';
  if (s < 60) return `Updated ${Math.round(s / 5) * 5}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `Updated ${m} min ago` : 'Updated over an hour ago';
}
