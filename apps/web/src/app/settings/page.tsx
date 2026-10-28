import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Settings — Flowboard' };

export default function Page() {
  return <ComingSoon title="Settings" eyebrow="Project" icon="settings" description="Project, account and board settings will live here. They are not part of the first beta." />;
}
