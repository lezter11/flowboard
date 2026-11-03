'use client';

import { createContext, useCallback, useContext, useMemo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';

import { redactProtectedDrafts, redactRefusedDrafts, redactSessionDraftTransition } from './protected-drafts';
import { setCurrentSessionActor } from './session-identity';
import { sessionState, accessFingerprint, type SessionState } from './session-state';

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

  useEffect(()=>queryClient.getQueryCache().subscribe((event)=>{if(event.type!=='updated'||event.action.type!=='error')return;const error=event.query.state.error;if(error instanceof ApiError&&[401,403,404].includes(error.status)){if(error.status===401)redactProtectedDrafts();else redactRefusedDrafts(event.query.queryKey);}}),[queryClient]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      redactProtectedDrafts();
      queryClient.clear();
      // Clear any board data cached in browser storage by earlier builds.
      try {
        Object.keys(window.sessionStorage)
          .filter((key) => key.startsWith('flowboard'))
          .forEach((key) => window.sessionStorage.removeItem(key));
      } catch {
        // Storage can be blocked; nothing else is cached there.
      }
      window.location.assign('/signin');
    }
  }, [queryClient]);

  const state = useMemo(() => sessionState(query.data,query.error,query.isError,describeError(query.error)),[query.data,query.error,query.isError]);
  const fingerprint = accessFingerprint(state);
  const previousScope = useRef<string|null>(null);
  const [verifiedActor,setVerifiedActor]=useState<string|null>(null);
  useEffect(() => {
    if(fingerprint===null) return;
    if(previousScope.current!==null && previousScope.current!==fingerprint) {
      redactSessionDraftTransition(previousScope.current,fingerprint);
      const protectedQuery = (entry:{queryKey:readonly unknown[]}) => entry.queryKey[0]!=='session';
      void queryClient.cancelQueries({predicate:protectedQuery});
      queryClient.removeQueries({predicate:protectedQuery});
    }
    previousScope.current=fingerprint;
    setVerifiedActor(state.status==='ready'?state.session.actor.id:null);
  },[fingerprint,queryClient]);

  const trustedState:SessionState=state.status==='ready'&&verifiedActor!==state.session.actor.id?{status:'loading'}:state;
  useEffect(()=>{setCurrentSessionActor(trustedState.status==='ready'?trustedState.session.actor.id:null);},[trustedState]);
  const value = useMemo(() => ({ state:trustedState, refetch: () => void query.refetch(), signOut }), [trustedState, query, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
