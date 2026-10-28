import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Activity — Flowboard' };

export default function Page() {
  return <ComingSoon title="Activity" description="Project activity history is not part of the first beta." />;
}
