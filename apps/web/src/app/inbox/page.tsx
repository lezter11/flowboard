import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Inbox — Flowboard' };

export default function Page() {
  return <ComingSoon title="Inbox" eyebrow="Notifications" icon="inbox" description="Mentions, assignments and replies will gather here. They are not part of the first beta." />;
}
