'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { landingFor } from '@/lib/landing';
import { useSession } from '@/lib/session';

/** Reached only when the edge did not redirect first (client-side navigation). SessionGate sends signed-out visitors to /signin. */
export default function HomePage() {
  const router = useRouter();
  const { state } = useSession();
  useEffect(() => {
    if (state.status !== 'ready') return;
    let cancelled = false;
    void landingFor(state.session).then((path) => { if (!cancelled) router.replace(path); });
    return () => { cancelled = true; };
  }, [state, router]);
  return <div role="status" className="state-note">Loading…</div>;
}
