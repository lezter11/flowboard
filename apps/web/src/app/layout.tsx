import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Providers } from '@/components/providers';
import { SessionGate } from '@/components/shell/session-gate';
import { AppShell } from '@/components/shell/app-shell';
import { IconSprite } from '@/components/ui/icon';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
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
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('flowboard-ui-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
      </head>
      <body>
        <IconSprite />
        <Providers>
          <SessionGate />
          <Suspense fallback={<div role="status" className="state-note">Loading Flowboard…</div>}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
