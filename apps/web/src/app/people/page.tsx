import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'People — Flowboard' };

export default function Page() {
  return <ComingSoon title="People" eyebrow="Project" icon="users" description="Project members, roles and board access will be managed here. They are not part of the first beta." />;
}
