'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { landingFor } from '@/lib/landing';
import { useSession } from '@/lib/session';

/** Pages that handle a signed-out visitor themselves. Everything else needs a session. */
const OPEN_ROUTES = ['/signin', '/invitation', '/invitations/accept'];

/**
 * Client half of entry routing. The Pages middleware (functions/_middleware.ts) handles page loads;
 * this covers in-app navigation and any host without that middleware, using the same GET /session answer.
 */
export function SessionGate() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSession();

  useEffect(() => {
    if (state.status === 'signedOut' && !OPEN_ROUTES.includes(pathname)) {
      router.replace('/signin');
    } else if (state.status === 'ready' && pathname === '/signin') {
      let cancelled = false;
      void landingFor(state.session).then((path) => { if (!cancelled) router.replace(path); });
      return () => { cancelled = true; };
    }
  }, [state, pathname, router]);

  return null;
}
