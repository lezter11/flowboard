'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProjectView } from './project-view';

function Inner() {
  const id = useSearchParams().get('id');
  if (!id) return <div className="flex-1 p-8 text-sm text-muted">No project selected.</div>;
  return <ProjectView projectId={id} />;
}

export default function ProjectPage() {
  return <Suspense fallback={<div className="flex-1 p-8 text-sm text-muted">Loading project...</div>}><Inner /></Suspense>;
}
