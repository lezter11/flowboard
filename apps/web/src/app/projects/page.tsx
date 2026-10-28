'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FolderKanban, Layers3, ShieldCheck, Plus, Sparkles } from 'lucide-react';
import { useSession } from '@/lib/session';
import type { SessionProjectSummary, SessionWorkspaceSummary } from '@flowboard/contracts';

export default function ProjectsPage() {
  const { state, refetch } = useSession();
  const loading = state.status === 'loading';
  const projects: SessionProjectSummary[] = state.status === 'ready' ? state.session.accessibleProjects : [];
  const workspaces: SessionWorkspaceSummary[] = state.status === 'ready' ? state.session.ownedWorkspaces : [];
  const actorName = state.status === 'ready' ? state.session.actor.displayName || state.session.actor.email : null;
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [createError, setCreateError] = useState('');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || workspaces.length === 0) return;
    try {
      setCreateError('');
      const wsId = workspaces[0].id;
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(wsId)}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `prj_create_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Failed with status ${res.status}`);
      }
      refetch();
      setNewProjectName('');
      setIsCreating(false);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create project.');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-6 bg-canvas text-ink">
      <div className="border-b border-line pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Workspace portfolio</p>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">Projects</h1>
          <p className="mt-1 text-xs text-muted">
            {actorName
              ? `Signed in as ${actorName}. Projects you own or have been granted access to.`
              : 'Projects keep related boards together. Sign in to view your projects.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && !isCreating && (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-[var(--accent-ink)] font-semibold text-xs hover:bg-accent-hover transition-colors focus-visible:outline-2"
            >
              <Plus className="w-4 h-4" /> Create project
            </button>
          )}
          {!actorName && (
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-surface font-semibold text-xs hover:opacity-90 transition-opacity focus-visible:outline-2"
            >
              Sign in to Flowboard
            </Link>
          )}
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreateProject} className="p-4 rounded-xl border border-line bg-surface space-y-3">
          <h3 className="text-sm font-bold">New Project</h3>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              autoFocus
              className="flex-1 px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button
              type="submit"
              disabled={!newProjectName.trim()}
              className="px-4 py-1.5 rounded-lg bg-accent text-[var(--accent-ink)] text-xs font-semibold hover:bg-accent-hover disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setCreateError('');
              }}
              className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-semibold hover:bg-surface-3"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        <section aria-labelledby="project-list-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-7 shadow-sm">
          <div className="border-b border-line pb-4 flex justify-between items-center">
            <h2 id="project-list-title" className="text-base font-bold text-ink">
              Your projects {projects.length > 0 && `(${projects.length})`}
            </h2>
          </div>

          {loading ? (
            <div className="py-16 text-center text-xs text-muted">Checking project access...</div>
          ) : projects.length > 0 ? (
            <div className="mt-4 divide-y divide-line">
              {projects.map((project) => (
                <div key={project.id} className="py-4 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link
                      href={`/project?id=${encodeURIComponent(project.id)}`}
                      className="text-sm font-bold text-ink hover:text-accent flex items-center gap-2 group"
                    >
                      <FolderKanban className="w-4 h-4 text-accent shrink-0" />
                      <span className="truncate">{project.name}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-faint group-hover:text-accent transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    {project.description && (
                      <p className="mt-1 text-xs text-muted truncate">{project.description}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-faint">
                      <span className="capitalize px-1.5 py-0.5 rounded bg-surface-3 font-medium">Role: {project.role}</span>
                      {project.isArchived && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">Archived</span>}
                    </div>
                  </div>
                  <Link
                    href={`/project?id=${encodeURIComponent(project.id)}`}
                    className="px-3 py-1.5 rounded-lg border border-line text-xs font-semibold hover:bg-surface-3 shrink-0"
                  >
                    Open boards
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-60 flex-col items-center justify-center px-4 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent">
                <FolderKanban aria-hidden="true" className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-ink">
                {actorName ? 'No projects yet' : 'Sign in to see your projects'}
              </h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                {actorName
                  ? 'Create your first project above to begin organizing team boards and cards.'
                  : 'Sign in with Google to load your private workspace.'}
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface-2 p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-faint">How work is organized</p>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-xs font-semibold text-ink">
              <FolderKanban aria-hidden="true" className="h-4 w-4 text-accent" /> Project <ArrowRight aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-faint" />
            </div>
            <div className="ml-5 mt-2 flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-xs text-ink-soft">
              <Layers3 aria-hidden="true" className="h-4 w-4 text-accent" /> Team boards
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              Owners see every board. Other members see the boards they have been granted.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 font-semibold text-xs text-ink">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-accent" /> Private by default
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              Access is checked on the server before any board or card is delivered.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
