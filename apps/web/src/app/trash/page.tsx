import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Trash — Flowboard' };

export default function Page() {
  return <ComingSoon title="Trash" eyebrow="Project" icon="trash" description="Deleted cards will wait here for 24 hours so they can be restored. Restore is not part of the first beta." />;
}
