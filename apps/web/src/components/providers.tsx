'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LazyMotion, MotionConfig } from 'motion/react';
import { SessionProvider } from '@/lib/session';
import { PollingProvider } from '@/components/polling';
import { NavigationGuard } from '@/components/navigation-guard';
import { hasUnsaved } from '@/lib/unsaved';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => { if (hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protectDrafts);
    return () => window.removeEventListener('beforeunload', protectDrafts);
  }, []);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* LazyMotion keeps the Motion core small; reducedMotion="user" turns transform animation off for people who ask. */}
      <LazyMotion features={() => import('@/lib/motion-features').then((module) => module.default)} strict>
        <MotionConfig reducedMotion="user">
          <SessionProvider><PollingProvider>{children}<NavigationGuard /></PollingProvider></SessionProvider>
        </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
