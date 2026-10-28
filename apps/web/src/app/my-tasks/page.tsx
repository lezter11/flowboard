import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'My tasks — Flowboard' };

export default function Page() {
  return <ComingSoon title="My tasks" description="A personal task queue is not part of the first beta." />;
}
