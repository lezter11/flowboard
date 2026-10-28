'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionData } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';

type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: SessionData };

interface SessionContextValue {
  state: SessionState;
  refetch: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await api.getSession()).data,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
  });

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.clear();
      window.location.assign('/signin');
    }
  }, [queryClient]);

  const state: SessionState = useMemo(() => {
    if (query.data) return { status: 'ready', session: query.data };
    if (query.isError) {
      if (query.error instanceof ApiError && query.error.status === 401) return { status: 'signedOut' };
      return { status: 'error', message: query.error instanceof Error ? query.error.message : 'Could not reach Flowboard.' };
    }
    return { status: 'loading' };
  }, [query.data, query.isError, query.error]);

  const value = useMemo(() => ({ state, refetch: () => void query.refetch(), signOut }), [state, query, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
