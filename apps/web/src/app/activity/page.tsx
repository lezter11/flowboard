import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Activity — Flowboard' };

export default function Page() {
  return <ComingSoon title="Activity" eyebrow="Project history" icon="activity" description="A filterable history of what changed in a project will appear here. It is not part of the first beta." />;
}
