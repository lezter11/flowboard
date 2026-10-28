import type { Metadata } from 'next';
import { MissingRouteImport } from '@/components/missing-route-import';

export const metadata: Metadata = { title: 'Import cards — Flowboard' };

export function generateStaticParams() {
  return [{ projectId: 'proj_fashion' }];
}

export default async function ProjectImportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <MissingRouteImport projectId={projectId} />;
}
