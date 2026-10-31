'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { SessionProjectSummary } from '@flowboard/contracts';
import { Icon } from '@/components/ui/icon';
import { ROLE_META, normalizeRole } from '@/lib/roles';
import { switcherGroups, switcherLabel } from '@/lib/project-switcher';

function Row({ project, current, onPick }: { project: SessionProjectSummary; current: boolean; onPick: () => void }) {
  return (
    <li>
      <Link className="rail-pswitch-row" href={`/project?id=${encodeURIComponent(project.id)}`} aria-current={current ? 'true' : undefined} title={project.name} onClick={onPick}>
        <span className="rail-pswitch-name">{project.name}</span>
        <span className="role-chip"><span className="sr-only">Your role: </span>{ROLE_META[normalizeRole(project.role)].label}</span>
      </Link>
    </li>
  );
}

/**
 * Rail header: shows the project you are in (or "Projects") and opens a list grouped Yours / Shared with you with a role chip on
 * each. A disclosure panel with real links: Tab and Shift+Tab work natively, Up and Down also move, Escape closes and returns focus.
 * It is built from the projects the session already lists, so it can never name something the person cannot open.
 */
export function ProjectSwitcher({ projects, current, compact, onNavigate }: { projects: SessionProjectSummary[]; current: SessionProjectSummary | null; compact: boolean; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = switcherLabel(current, projects);
  const { yours, shared } = switcherGroups(projects);

  const close = useCallback((returnFocus: boolean) => {
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);
  const pick = () => { setOpen(false); onNavigate(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onFocusOut = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    const root = rootRef.current;
    root?.addEventListener('focusout', onFocusOut);
    return () => { document.removeEventListener('mousedown', onDown); root?.removeEventListener('focusout', onFocusOut); };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.rail-pswitch-panel a')?? []);
    if (!open || !items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const group = (title: string, id: string, list: SessionProjectSummary[]) => list.length > 0 && (
    <section aria-labelledby={`${panelId}-${id}`}>
      <h3 className="rail-pswitch-group" id={`${panelId}-${id}`}>{title}</h3>
      <ul>{list.map((p) => <Row key={p.id} project={p} current={p.id === current?.id} onPick={pick} />)}</ul>
    </section>
  );

  return (
    <div className="rail-pswitch" ref={rootRef} onKeyDown={onKeyDown}>
      <button ref={buttonRef} className="workspace-switch" type="button" aria-expanded={open} aria-controls={panelId} aria-haspopup="true" aria-label={`${label.title}, ${label.subtitle}. Switch project`} data-tip={label.title} onClick={() => setOpen((v) => !v)}>
        <span className="workspace-avatar" aria-hidden="true">{label.mark}</span>
        <span className="workspace-copy">
          <strong>{label.title}</strong>
          <span>{label.subtitle}</span>
        </span>
        <Icon name="chevron-down" />
      </button>
      <div className={`rail-pswitch-panel${compact ? ' is-compact' : ''}`} id={panelId} hidden={!open} role="group" aria-label="Switch project">
        {group('Yours', 'yours', yours)}
        {group('Shared with you', 'shared', shared)}
        {yours.length + shared.length === 0 && <p className="rail-pswitch-empty">No open projects yet.</p>}
        <div className="rail-pswitch-foot">
          <Link className="btn sm" href="/projects" onClick={pick}>All projects</Link>
          <Link className="btn sm primary" href="/projects?new=1" onClick={pick}><Icon name="plus" />New project</Link>
        </div>
      </div>
    </div>
  );
}
