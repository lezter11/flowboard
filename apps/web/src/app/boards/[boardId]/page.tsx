import { Suspense, use } from 'react';
import { BoardView } from '@/components/board-view';

export function generateStaticParams() {
  return [
    { boardId: 'board_dev' },
    { boardId: 'board_ops' },
    { boardId: 'board_mktg' },
    { boardId: 'unified' },
  ];
}

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  return (
    <Suspense fallback={<div className="flex-1 p-12 text-sm text-muted">Loading board...</div>}>
      <BoardView boardId={boardId} />
    </Suspense>
  );
}
