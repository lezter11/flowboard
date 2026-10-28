import type { Metadata } from 'next';
import { MissingRouteInvitation } from '@/components/missing-route-invitation';

export const metadata: Metadata = { title: 'Invitation — Flowboard' };

export default function InvitationPage() { return <MissingRouteInvitation />; }
