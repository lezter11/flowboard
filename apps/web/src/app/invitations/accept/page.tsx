import type { Metadata } from 'next';
import { MissingRouteInvitation } from '@/components/missing-route-invitation';

export const metadata: Metadata = { title: 'Accept invitation — Flowboard' };

export default function InvitationAcceptPage() { return <MissingRouteInvitation />; }
