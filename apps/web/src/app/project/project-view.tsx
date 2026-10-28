'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FolderKanban,
  Layers,
  Users,
  Plus,
  ArrowRight,
  ShieldCheck,
  Code2,
  Cpu,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Board, Project } from '@flowboard/contracts';

interface Props {
  projectId: string;
}

export function ProjectView({ projectId }: Props) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState('');
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [createBoardError, setCreateBoardError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadProjectData() {
      try {
        setLoading(true);
        setError('');

        const [projRes, boardsRes] = await Promise.allSettled([
          api.getProject(projectId),
          api.listProjectBoards(projectId),
        ]);

        if (cancelled) return;

        if (projRes.status === 'fulfilled' && projRes.value?.data) {
          setProject(projRes.value.data);
        } else {
          // If project not found or unauthenticated
          setError('Project not found or you lack permission to view it.');
        }

        if (boardsRes.status === 'fulfilled' && boardsRes.value?.data) {
          setBoards(boardsRes.value.data);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load project.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProjectData();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    try {
      setCreateBoardError('');
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/boards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `brd_create_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        },
        body: JSON.stringify({ name: newBoardName.trim() }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Failed to create board (${res.status})`);
      }
      const data = await res.json();
      setBoards((prev) => [...prev, data.data]);
      setNewBoardName('');
      setIsCreatingBoard(false);
    } catch (err: any) {
      setCreateBoardError(err?.message || 'Failed to create board.');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-8 max-w-5xl mx-auto w-full text-center py-24 text-xs text-muted">
        Loading project workspace...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex-1 p-6 sm:p-10 max-w-3xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-ink">Project unavailable</h1>
        <p className="mt-2 text-sm text-muted">{error || 'This project is not available to you.'}</p>
        <div className="mt-6 flex gap-3">
          <Link href="/projects" className="px-4 py-2 rounded-xl bg-surface border border-line text-xs font-semibold hover:bg-surface-3">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-6 bg-canvas text-ink">
      <div className="border-b border-line pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-muted mb-2">
            <Link href="/projects" className="hover:text-ink">Projects</Link>
            <span>/</span>
            <span className="text-ink font-semibold">{project.name}</span>
          </nav>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">{project.name}</h1>
          <p className="mt-1 text-xs text-muted">
            {project.description || 'Project boards and team delivery.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isCreatingBoard && (
            <button
              type="button"
              onClick={() => setIsCreatingBoard(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-[var(--accent-ink)] font-semibold text-xs hover:bg-accent-hover transition-colors focus-visible:outline-2"
            >
              <Plus className="w-4 h-4" /> Add board
            </button>
          )}
        </div>
      </div>

      {isCreatingBoard && (
        <form onSubmit={handleCreateBoard} className="p-4 rounded-xl border border-line bg-surface space-y-3">
          <h3 className="text-sm font-bold">Create New Board in {project.name}</h3>
          {createBoardError && <p className="text-xs text-red-600">{createBoardError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="e.g. Developers, Operations, Marketing"
              autoFocus
              className="flex-1 px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={!newBoardName.trim()}
              className="px-4 py-1.5 rounded-lg bg-accent text-[var(--accent-ink)] text-xs font-semibold hover:bg-accent-hover disabled:opacity-50"
            >
              Create Board
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreatingBoard(false);
                setCreateBoardError('');
              }}
              className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-semibold hover:bg-surface-3"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Sub-Boards Grid */}
      <section>
        <div className="border-b border-line pb-3 mb-4 flex justify-between items-center">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
            Boards ({boards.length})
          </h2>
        </div>

        {boards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {boards.map((board) => (
              <div
                key={board.id}
                className="rounded-2xl border border-line bg-surface p-5 hover:border-line-strong hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-xl bg-surface-3 border border-line">
                      <FolderKanban className="w-4 h-4 text-accent" />
                    </span>
                    {board.isArchived && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700">Archived</span>
                    )}
                  </div>
                  <h3 className="mt-4 text-base font-bold text-ink">{board.name}</h3>
                  <p className="mt-1 text-xs text-muted line-clamp-2">
                    {'Team Kanban workflow.'}
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-line flex items-center justify-between">
                  <span className="text-[11px] text-faint">Version {board.structureVersion}</span>
                  <Link
                    href={`/board?id=${encodeURIComponent(board.id)}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                  >
                    Open board <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center border border-dashed border-line rounded-2xl p-6">
            <Layers className="w-8 h-8 text-faint mx-auto" />
            <h3 className="mt-3 text-sm font-semibold">No boards you can open yet</h3>
            <p className="mt-1 text-xs text-muted">Create a board for your team, or ask an owner for board access.</p>
            <button
              type="button"
              onClick={() => setIsCreatingBoard(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-[var(--accent-ink)] text-xs font-semibold hover:bg-accent-hover"
            >
              <Plus className="w-4 h-4" /> Create first board
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
