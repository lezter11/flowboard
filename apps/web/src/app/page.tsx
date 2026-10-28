'use client';

import { Suspense } from 'react';
import { BoardView } from '@/components/board-view';
export default function HomePage() { return <Suspense fallback={<div className="flex-1 p-12 text-sm text-muted">Loading project board preview...</div>}><BoardView /></Suspense>; }
