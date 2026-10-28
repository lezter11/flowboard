import type { Metadata } from 'next';
import { InvitationAcceptPage } from '@/components/invitation/accept-screen';

export const metadata: Metadata = { title: 'Invitation — Flowboard' };

export default function Page() {
  return <InvitationAcceptPage />;
}
