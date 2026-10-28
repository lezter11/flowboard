import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'People — Flowboard' };

export default function Page() {
  return <ComingSoon title="People" description="Member and invitation management is not part of the first beta." />;
}
