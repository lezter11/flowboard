import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Settings — Flowboard' };

export default function Page() {
  return <ComingSoon title="Settings" description="Project settings are not part of the first beta." />;
}
