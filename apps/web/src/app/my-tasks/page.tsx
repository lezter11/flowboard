import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'My tasks — Flowboard' };

export default function Page() {
  return <ComingSoon title="My tasks" eyebrow="Your work" icon="list" description="A personal queue of cards assigned to you across projects will appear here. It is not part of the first beta." />;
}
