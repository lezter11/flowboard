import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Import cards — Flowboard' };

export default function Page() {
  return <ComingSoon title="Import cards" description="Spreadsheet import is not part of the first beta." />;
}
