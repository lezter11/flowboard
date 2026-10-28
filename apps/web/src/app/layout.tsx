import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flowboard - Project Portfolio Kanban',
  description:
    'Production Kanban workspace with unified multi-board visibility, pastel green completion states, and private scoped assets.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <Suspense
            fallback={
              <div className="flex h-screen items-center justify-center text-sm font-semibold text-muted">
                Loading Flowboard...
              </div>
            }
          >
            <AppShell>{children}</AppShell>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
