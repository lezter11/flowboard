import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Inbox — Flowboard' };

export default function Page() {
  return <ComingSoon title="Inbox" description="Mentions and assignment alerts are not part of the first beta." />;
}
