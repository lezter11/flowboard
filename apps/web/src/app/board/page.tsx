'use client';

import { Suspense } from 'react';
import { BoardView } from '@/components/board-view';

export default function BoardPage() {
  return <Suspense fallback={<div className="flex-1 p-12 text-sm text-muted">Loading board...</div>}><BoardView /></Suspense>;
}
