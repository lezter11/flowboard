import type { Metadata } from 'next';
import { MissingRouteImport } from '@/components/missing-route-import';

export const metadata: Metadata = { title: 'Import cards — Flowboard' };

export default function ImportPage() { return <MissingRouteImport />; }
