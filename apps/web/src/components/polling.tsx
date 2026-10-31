'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { createPoller, describeAge, isTrouble, type PollerState, type TickResult } from '@/lib/poller';
import { useSession } from '@/lib/session';

/**
 * Foreground polling, configured once. Screens declare which query keys are live with `usePollKeys`; this provider
 * refetches exactly those, only while the tab is visible and the user is signed in (see lib/poller.ts for timing).
 */
interface PollingValue {
  state: PollerState;
  online: boolean;
  /** Refetch live keys soon, e.g. after the user's own save. */
  pokeSoon: (ms?: number) => void;
  register: (keys: readonly QueryKey[]) => () => void;
  hold: () => () => void;
}

const PollingContext = createContext<PollingValue | null>(null);
const FALLBACK: PollingValue = { state: { lastSuccessAt: null, failures: 0, stopped: false }, online: true, pokeSoon: () => {}, register: () => () => {}, hold: () => () => {} };

export function PollingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { state: session } = useSession();
  const signedIn = session.status === 'ready';
  // The session is always live: role changes, removal and project archive reach open screens through it.
  const keys = useRef(new Map<string, { key: QueryKey; count: number }>([[JSON.stringify(['session']), { key: ['session'], count: 1 }]]));
  const holds = useRef(0);
  const [pollState, setPollState] = useState<PollerState>({ lastSuccessAt: null, failures: 0, stopped: false });
  const [online, setOnline] = useState(true);
  const pollerRef = useRef<ReturnType<typeof createPoller> | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const poller = createPoller({
      isVisible: () => document.visibilityState === 'visible',
      isHeld: () => holds.current > 0,
      onChange: setPollState,
      run: async (): Promise<TickResult> => {
        const live = Array.from(keys.current.values());
        if (live.length === 0) return 'ok';
        const results = await Promise.allSettled(live.map(({ key }) => queryClient.refetchQueries({ queryKey: key, exact: true, type: 'active' }, { throwOnError: true })));
        const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
        if (errors.some((e) => e instanceof ApiError && e.status === 401)) {
          // The session gate turns this into the sign-in screen with the safe ?next= path.
          void queryClient.invalidateQueries({ queryKey: ['session'] });
          return 'signedOut';
        }
        // 403/404 mean the server answered; the screen that owns the query explains it. Only transport/5xx failures back off.
        const transport = errors.filter((e) => !(e instanceof ApiError) || e.status === 0 || e.status >= 500);
        return transport.length > 0 && transport.length === results.length ? 'failed' : 'ok';
      },
    });
    pollerRef.current = poller;
    poller.start();
    const wake = () => { if (document.visibilityState === 'visible') poller.poke(); else poller.pause(); };
    const goOnline = () => { setOnline(true); poller.poke(); };
    const goOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [signedIn, queryClient]);

  const register = useCallback((list: readonly QueryKey[]) => {
    const ids = list.map((key) => JSON.stringify(key));
    list.forEach((key, i) => { const entry = keys.current.get(ids[i]!); if (entry) entry.count += 1; else keys.current.set(ids[i]!, { key, count: 1 }); });
    return () => ids.forEach((id) => { const entry = keys.current.get(id); if (!entry) return; entry.count -= 1; if (entry.count <= 0) keys.current.delete(id); });
  }, []);
  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => { if (released) return; released = true; holds.current -= 1; if (holds.current === 0) pollerRef.current?.poke(1000); };
  }, []);
  const pokeSoon = useCallback((ms = 1000) => pollerRef.current?.poke(ms), []);

  const value = useMemo(() => ({ state: pollState, online, pokeSoon, register, hold }), [pollState, online, pokeSoon, register, hold]);
  return <PollingContext.Provider value={value}>{children}</PollingContext.Provider>;
}

export function usePolling(): PollingValue { return useContext(PollingContext) ?? FALLBACK; }

/** Marks query keys as live while the calling component is mounted (and `enabled`). */
export function usePollKeys(keys: readonly QueryKey[], enabled = true) {
  const { register } = usePolling();
  const signature = JSON.stringify(keys);
  useEffect(() => {
    if (!enabled) return;
    return register(JSON.parse(signature) as QueryKey[]);
  }, [register, signature, enabled]);
}

/** Pauses polling while true (a drag, a move in flight); polling resumes ~1 s after release. */
export function usePollHold(active: boolean) {
  const { hold } = usePolling();
  useEffect(() => (active ? hold() : undefined), [active, hold]);
}

/**
 * Quiet freshness pill next to the board title: a dot and "Updated 12s ago". It is an image with a stable label, not a live
 * region, because the number changes every few seconds. Width is reserved so the title never shifts.
 */
export function PollAge() {
  const { state } = useNow();
  const age = describeAge(state.lastSuccessAt, state.now);
  if (!age) return null;
  return (
    <span className="poll-pill" role="img" aria-label={`Board ${age.charAt(0).toLowerCase()}${age.slice(1)}`}>
      <i aria-hidden="true" />
      <span className="poll-pill-text" key={age} aria-hidden="true">{age}</span>
    </span>
  );
}

function useNow() {
  const { state } = usePolling();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  return { state: { ...state, now } };
}

/** App-wide banner when polls keep failing or the browser is offline. The live region only speaks on trouble and recovery. */
export function PollBanner() {
  const { online } = usePolling();
  const { state } = useNow();
  const trouble = isTrouble(state.failures, online);
  const wasTrouble = useRef(false);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (trouble && !wasTrouble.current) setAnnounce(online ? 'Live updates are paused. Retrying.' : 'You are offline. Changes will refresh when you reconnect.');
    else if (!trouble && wasTrouble.current) setAnnounce('Live updates resumed.');
    wasTrouble.current = trouble;
  }, [trouble, online]);
  return (
    <>
      {trouble && (
        <p className="poll-banner" role="note">
          {online ? 'Can’t refresh right now. What you see may be out of date; we’ll keep trying.' : 'You’re offline. What you see may be out of date.'}
          {state.lastSuccessAt !== null && <> {describeAge(state.lastSuccessAt, state.now)}.</>}
        </p>
      )}
      <span className="sr-only" aria-live="polite">{announce}</span>
    </>
  );
}
