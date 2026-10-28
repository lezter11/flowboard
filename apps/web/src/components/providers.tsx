'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LazyMotion, MotionConfig } from 'motion/react';
import { SessionProvider } from '@/lib/session';

export function Providers({ children }: { children: React.ReactNode }) {
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
          <SessionProvider>{children}</SessionProvider>
        </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
