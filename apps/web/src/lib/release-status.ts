const POLL_MS = 30_000;
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1024;

/** Only the public boolean is accepted; response text never becomes UI or logging. */
export async function readReleaseStatus(response: Response, signal: AbortSignal): Promise<boolean> {
  const refuse = () => { void response.body?.cancel().catch(() => {}); return new Error('Invalid release status'); };
  // Explicit retirement contract: legacy Pages without this asset returns404.
  // Only absence/retirement ends the notice; HTML fallbacks and other errors do not.
  if (response.status === 404 || response.status === 410) { void response.body?.cancel().catch(() => {}); return false; }
  if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw refuse();
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw refuse();
  if (!response.body || signal.aborted) throw refuse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0, reads = 0;
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error('Release status stopped')); });
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('Release status stopped');
      if (++reads > MAX_BYTES + 1) throw new Error('Invalid release status');
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Invalid release status');
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('active' in value) || typeof value.active !== 'boolean') throw new Error('Invalid release status');
    return value.active;
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createReleaseStatusController(options: {
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  isVisible: () => boolean;
  onActive: (active: boolean) => void;
}) {
  let started = false, stopped = false, running = false, refreshOnReturn = false;
  let wasVisible = options.isVisible();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clear();
    if (started && !stopped && options.isVisible()) timer = setTimeout(() => { void run(); }, delay);
  };
  async function run() {
    timer = undefined;
    if (!started || stopped || running || !options.isVisible()) return;
    running = true;
    refreshOnReturn = false;
    const current = new AbortController();
    request = current;
    const timeout = setTimeout(() => current.abort(), TIMEOUT_MS);
    try {
      // Await actual fetch settlement: even an abort-ignoring requester cannot overlap.
      const response = await options.fetcher('/release-status.json', {
        method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: current.signal,
      });
      const active = await readReleaseStatus(response, current.signal);
      if (!stopped && !current.signal.aborted && options.isVisible()) options.onActive(active);
    } catch {
      // Keep the last valid state; an error cannot announce that an update ended.
    } finally {
      clearTimeout(timeout);
      current.abort();
      if (request === current) request = undefined;
      running = false;
      schedule(refreshOnReturn ? 0 : POLL_MS);
    }
  }
  return {
    start() {
      if (started || stopped) return;
      started = true;
      wasVisible = options.isVisible();
      schedule(0);
    },
    visibilityChanged() {
      const visible = options.isVisible();
      if (visible === wasVisible || stopped || !started) return;
      wasVisible = visible;
      clear();
      if (!visible) request?.abort();
      else if (running) refreshOnReturn = true;
      else schedule(0);
    },
    stop() { stopped = true; clear(); request?.abort(); },
  };
}
