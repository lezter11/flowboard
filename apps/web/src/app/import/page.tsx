import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Import cards — Flowboard' };

export default function Page() {
  return <ComingSoon title="Import cards" eyebrow="Project" icon="upload" description="Spreadsheet import with a preview before anything is created will appear here. It is not part of the first beta." />;
}
