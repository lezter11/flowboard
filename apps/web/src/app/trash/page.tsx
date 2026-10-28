import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Trash — Flowboard' };

export default function Page() {
  return <ComingSoon title="Trash" description="Card trash and restore are not part of the first beta." />;
}
