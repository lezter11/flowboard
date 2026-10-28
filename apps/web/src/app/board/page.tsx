'use client';

import { Suspense } from 'react';
import { BoardView } from '@/components/board/board-view';

export default function BoardPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading board…</div>}><BoardView /></Suspense>;
}
