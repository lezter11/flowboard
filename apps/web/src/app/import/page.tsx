'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ImportStatus } from '@flowboard/contracts';
import { describeFailureOf } from '@/lib/error-catalogue';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { can, normalizeRole } from '@/lib/roles';
import { useProjectBoards } from '@/lib/portfolio';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { useToast } from '@/components/ui/toasts';

type Stage = 'upload' | 'preview' | 'confirm' | 'done';
const MAX_BYTES = 5 * 1024 * 1024;
const STEPS: Array<[Stage, string, string]> = [
  ['upload', 'Upload', 'Choose board and XLSX'],
  ['preview', 'Preview', 'Validate every mapped row'],
  ['confirm', 'Confirm', 'Explicit all-or-nothing commit'],
  ['done', 'Result', 'Created cards and counts'],
];
const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`);

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className={`preview-stat${tone ? ` ${tone}` : ''}`}><span className="label">{label}</span><span className="value">{value}</span></div>;
}

function Summary({ status }: { status: ImportStatus }) {
  const c = status.counts;
  const blocking = c.invalid + c.conflict;
  return (
    <div className="preview-summary">
      <Stat label="Nonempty rows" value={c.total} />
      <Stat label="Ready" value={c.new} tone="ok" />
      <Stat label="Invalid" value={c.invalid} tone={c.invalid ? 'bad' : ''} />
      <Stat label="Conflicts" value={c.conflict} tone={c.conflict ? 'warn' : ''} />
      <Stat label="Would create" value={blocking ? 0 : c.new} tone={blocking ? 'bad' : 'ok'} />
    </div>
  );
}

function ImportScreen() {
  const params = useSearchParams();
  const { state } = useSession();
  const toast = useToast();
  const projects = useMemo(() => (state.status === 'ready' ? state.session.accessibleProjects : []).filter((p) => can(normalizeRole(p.role), 'manageBoard') && !p.isArchived), [state]);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const boards = useProjectBoards(project?.id ?? null);
  const boardList = (boards.data ?? []).filter((b) => !b.isArchived);
  const [boardId, setBoardId] = useState(params.get('board') ?? '');
  const board = boardList.find((b) => b.id === boardId) ?? boardList[0];
  const snapshot = useQuery({ queryKey: ['board', board?.id], queryFn: async () => (await api.getBoardSnapshot(board!.id, { cardLimitPerColumn: 1 })).data, enabled: !!board });
  const columns = [...(snapshot.data?.columns ?? [])].sort((a, b) => a.position - b.position);
  const [columnId, setColumnId] = useState('');
  const defaultColumn = columns.find((c) => c.id === columnId) ?? columns[0];

  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commitOpen, setCommitOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const key = useRef<string>(crypto.randomUUID());

  const choose = (picked: File | undefined) => {
    setFileError('');
    if (!picked) return;
    if (!/\.xlsx$/i.test(picked.name)) { setFileError('Choose an .xlsx workbook.'); return; }
    if (picked.size > MAX_BYTES) { setFileError('The file is larger than 5 MiB.'); return; }
    if (picked.size === 0) { setFileError('The file is empty.'); return; }
    setFile(picked);
  };

  const upload = async () => {
    if (!file || !board || !defaultColumn) return;
    setBusy(true); setError('');
    try {
      const res = await api.createImport(board.id, file, defaultColumn.id);
      setStatus(res.data);
      setStage('preview');
    } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (status && status.cancellationAllowed && stage !== 'done') { try { await api.cancelImport(status.id); } catch { /* the preview expires on its own */ } }
    setStatus(null); setFile(null); setError(''); setStage('upload'); key.current = crypto.randomUUID();
  };
  const commit = async () => {
    if (!status || !status.previewDigest) return;
    setBusy(true); setError('');
    try {
      const res = await api.commitImport(status.id, { previewDigest: status.previewDigest, defaultColumnId: status.defaultColumnId, expectedVersion: status.version }, key.current);
      setStatus(res.data);
      setCommitOpen(false);
      setStage('done');
      toast(`${res.data.counts.created} cards created`, { icon: 'check-circle' });
    } catch (err) { setCommitOpen(false); setError(describeError(err)); } finally { setBusy(false); }
  };

  if (state.status === 'ready' && projects.length === 0) {
    return (
      <section className="ph-empty" style={{ marginTop: 24 }}>
        <span className="ph-empty-mark" aria-hidden="true"><Icon name="lock" /></span>
        <h3>Import is unavailable</h3>
        <p>Only project owners and managers of an active project can import cards.</p>
        <Link className="btn" href="/projects">Browse projects</Link>
      </section>
    );
  }

  const activeIndex = STEPS.findIndex(([id]) => id === stage);
  const blocking = status ? status.counts.invalid + status.counts.conflict : 0;
  const rows = status?.rows ?? [];

  return (
    <div id="importContent">
      <div className="page-head">
        <div className="page-head-copy">
          <p className="eyebrow">{project?.name ?? 'Project'} <span className="badge">Create-only XLSX</span></p>
          <h1>Import cards</h1>
          <p className="page-sub"><span>Seven columns</span><span className="dot" aria-hidden="true" /><span>200 nonempty rows</span><span className="dot" aria-hidden="true" /><span>5 MiB upload</span><span className="dot" aria-hidden="true" /><span>All-or-nothing commit</span></p>
        </div>
        <div className="page-actions">
          {board && <Link className="btn" href={`/board?id=${encodeURIComponent(board.id)}`}><Icon name="board" />Back to board</Link>}
          {board && <a className="btn ghost" href={`/api/v1/boards/${encodeURIComponent(board.id)}/import-template`} download><Icon name="download" />Download template</a>}
        </div>
      </div>

      <div className="review-bar">
        <Icon name="shield" />
        <span><strong>Preview creates nothing.</strong> Validate every row, then confirm explicitly. Invalid or conflicting rows block the whole batch.</span>
        <span className="spacer" />
        <span className="badge">Owner / Manager only</span>
      </div>

      <div className="steps" aria-label="Import stages">
        {STEPS.map(([id, title, sub], index) => (
          <div key={id} className={`step${index === activeIndex ? ' is-active' : ''}${index < activeIndex ? ' is-done' : ''}`}>
            <span className="step-num">{index + 1}</span>
            <span className="step-copy"><strong>{title}</strong><span>{sub}</span></span>
          </div>
        ))}
      </div>

      <div className="split-layout wide-aside">
        <div className="stack">
          {error && <div className="note danger" role="alert"><Icon name="x-circle" /><span>{error}</span></div>}

          {stage === 'upload' && (
            <section className="panel" aria-labelledby="uploadTitle">
              <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title" id="uploadTitle">Upload a workbook</h2><p className="panel-sub">Choose the destination board, then select one .xlsx file.</p></div><div className="panel-actions"><span className="badge">Step 1 of 4</span></div></div>
              <div className="panel-body stack">
                <div className="form-grid">
                  <div className="field">
                    <label className="field-label" htmlFor="importProject">Project</label>
                    <select className="control" id="importProject" value={project?.id ?? ''} onChange={(event) => { setProjectId(event.target.value); setBoardId(''); setColumnId(''); }}>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <p className="field-help">An import cannot create or switch projects.</p>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="importBoard">Destination board</label>
                    <select className="control" id="importBoard" value={board?.id ?? ''} onChange={(event) => { setBoardId(event.target.value); setColumnId(''); }}>
                      {boardList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <p className="field-help">Cards inherit this board&apos;s project access.</p>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="importColumn">Default column</label>
                    <select className="control" id="importColumn" value={defaultColumn?.id ?? ''} onChange={(event) => setColumnId(event.target.value)}>
                      {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="field-help">Used for rows whose Status is blank.</p>
                  </div>
                </div>
                <div>
                  <label className="sr-only" htmlFor="importFile">Workbook file</label>
                  <input id="importFile" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => choose(event.target.files?.[0])} />
                  <div
                    className="dropzone dropzone-lg"
                    role="button"
                    tabIndex={0}
                    aria-label="Choose an XLSX workbook"
                    onClick={() => input.current?.click()}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}
                  >
                    <Icon name="upload" />
                    <strong>{file ? file.name : 'Drop an .xlsx workbook here'}</strong>
                    <span>{file ? `${formatBytes(file.size)} · ready to validate` : 'or choose a file · maximum 5 MiB · 200 nonempty rows'}</span>
                  </div>
                  <p className="form-error" role="alert" hidden={!fileError}>{fileError}</p>
                </div>
                <div className="note"><Icon name="file" /><span><strong>Template:</strong> seven columns and a priority dropdown. Extra blank rows are ignored.</span></div>
                <div className="form-actions"><span className="spacer" /><button className="btn primary" type="button" disabled={!file || !board || !defaultColumn || busy} onClick={() => void upload()}>{busy ? 'Validating…' : 'Validate workbook'}<Icon name="arrow-right" /></button></div>
              </div>
            </section>
          )}

          {stage === 'preview' && status && (
            <section className="panel" aria-labelledby="previewTitle">
              <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title" id="previewTitle">Preview mapped rows</h2><p className="panel-sub">Validation happens before any card exists. Fix the workbook and upload again if a row blocks commit.</p></div><div className="panel-actions"><span className="badge">Step 2 of 4</span></div></div>
              <div className="panel-body stack">
                <div className="file-selected">
                  <Icon name="file" />
                  <span className="file-copy"><strong>{file?.name}</strong><span>{file ? formatBytes(file.size) : ''} · {status.counts.total} nonempty row{status.counts.total === 1 ? '' : 's'} · {board?.name}</span></span>
                  <button className="btn sm" type="button" onClick={() => void reset()}>Choose another</button>
                </div>
                <Summary status={status} />
                {status.error && <div className="note danger" role="alert"><Icon name="x-circle" /><span><strong>{describeFailureOf({ status: 422, code: status.error.code }).title}.</strong> {describeFailureOf({ status: 422, code: status.error.code }).body}</span></div>}
                {blocking > 0
                  ? <div className="note danger"><Icon name="x-circle" /><span><strong>{blocking} blocking row{blocking === 1 ? '' : 's'}.</strong> {status.counts.invalid} invalid and {status.counts.conflict} conflicting. No cards will be created until every row is ready. There is no partial success.</span></div>
                  : <div className="note success"><Icon name="check-circle" /><span><strong>Every row is ready.</strong> {status.counts.new} card{status.counts.new === 1 ? '' : 's'} can be created. Nothing has been written yet.</span></div>}
                <div className="table-wrap">
                  <table className="data-table preview-table">
                    <thead><tr><th>Row</th><th>External ID</th><th>Title</th><th>Priority</th><th>Due Date</th><th>Assignees</th><th>Status</th><th>Result</th></tr></thead>
                    <tbody>
                      {rows.map((row) => {
                        const bad = row.outcome === 'invalid';
                        const conflict = row.outcome === 'conflict';
                        const first = row.errors[0];
                        return (
                          <tr key={row.rowNumber}>
                            <td className="mono">{row.rowNumber}</td>
                            <td className={`mono${conflict ? ' is-conflict' : ''}`}>{row.externalId}</td>
                            <td><strong>{row.title}</strong></td>
                            <td style={{ textTransform: 'capitalize' }}>{row.priority}</td>
                            <td>{row.dueDate ?? '—'}</td>
                            <td>{row.assigneeIds.length ? `${row.assigneeIds.length} assignee${row.assigneeIds.length === 1 ? '' : 's'}` : '—'}</td>
                            <td>{row.status ?? '—'}</td>
                            <td className={bad ? 'is-error' : conflict ? 'is-conflict' : ''}>
                              {bad ? <><span className="status-chip invalid">Invalid</span>{first && <p className="row-message">{first.field}: {first.message}</p>}</>
                                : conflict ? <><span className="status-chip conflict">Conflict</span>{first && <p className="row-message warn">{first.field}: {first.message}</p>}</>
                                : row.outcome === 'already_imported' ? <span className="status-chip conflict">Already imported</span>
                                : <span className="status-chip ready">Ready</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {status.nextCursor && <p className="field-help">Showing the first {rows.length} rows; the rest are validated too.</p>}
                <div className="form-actions">
                  <button className="btn" type="button" onClick={() => void reset()}><Icon name="arrow-left" />Back to upload</button>
                  <span className="spacer" />
                  <button className="btn primary" type="button" disabled={!status.canCommit || blocking > 0} onClick={() => setStage('confirm')}>Continue to confirm <Icon name="arrow-right" /></button>
                </div>
              </div>
            </section>
          )}

          {stage === 'confirm' && status && (
            <section className="panel" aria-labelledby="confirmTitle">
              <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title" id="confirmTitle">Confirm the batch</h2><p className="panel-sub">No cards exist yet. This is the explicit commit step.</p></div><div className="panel-actions"><span className="badge">Step 3 of 4</span></div></div>
              <div className="panel-body stack">
                <Summary status={status} />
                <div className="file-selected"><Icon name="board" /><span className="file-copy"><strong>{board?.name}</strong><span>{file?.name} · {status.counts.new} card{status.counts.new === 1 ? '' : 's'} · create-only</span></span><span className="status-chip ready">Ready</span></div>
                <div className="note"><Icon name="shield" /><span><strong>All-or-nothing.</strong> If a person, column or External ID changed since preview, the server rejects the entire batch. Nothing is silently skipped.</span></div>
                <div className="note"><Icon name="columns" /><span>Cards append to their mapped columns. The server assigns card keys and preserves manual order.</span></div>
                <div className="form-actions">
                  <button className="btn" type="button" onClick={() => setStage('preview')}><Icon name="arrow-left" />Back to preview</button>
                  <span className="spacer" />
                  <button className="btn primary" type="button" onClick={() => setCommitOpen(true)}><Icon name="upload" />Confirm import</button>
                </div>
              </div>
            </section>
          )}

          {stage === 'done' && status && (
            <section className="panel" aria-labelledby="resultTitle">
              <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title" id="resultTitle">Import result</h2><p className="panel-sub">Committed as one batch. No rows were skipped or partially written.</p></div><div className="panel-actions"><span className="badge">Step 4 of 4</span></div></div>
              <div className="panel-body stack">
                <div className="result-banner">
                  <span className="success-icon"><Icon name="check-circle" /></span>
                  <div><h2>{status.counts.created} card{status.counts.created === 1 ? '' : 's'} created</h2><p>{status.counts.created} of {status.counts.total} rows committed to {board?.name}. Invalid rows: {status.counts.invalid}. Conflicts: {status.counts.conflict}. Comments and images imported: 0.</p></div>
                </div>
                <div className="result-list">
                  {rows.filter((r) => r.outcome === 'created').map((row) => (
                    <div key={row.rowNumber} className="result-list-row"><span>{row.title}</span><span className="spacer" /><span className="tiny faint mono">{row.externalId}</span><span className="status-chip ready">Created</span></div>
                  ))}
                </div>
                <div className="note"><Icon name="image" /><span>Imported cards start with no comments and no images. Assignees, priority, due date and column come from the workbook.</span></div>
                <div className="form-actions">
                  {board && <Link className="btn primary" href={`/board?id=${encodeURIComponent(board.id)}`}><Icon name="board" />Open board</Link>}
                  <button className="btn" type="button" onClick={() => void reset()}>Import another file</button>
                  {project && <Link className="btn ghost" href={`/project?id=${encodeURIComponent(project.id)}`}>Project overview</Link>}
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="panel">
            <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">Import contract</h2><p className="panel-sub">Version 1 · create-only</p></div></div>
            <div className="panel-body stack-sm">
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Workbook</span><span className="small">.xlsx only</span></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Upload limit</span><span className="small">5 MiB</span></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Nonempty rows</span><span className="small">200 maximum</span></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small muted">Commit</span><span className="small">All or nothing</span></div>
              <div className="divider" />
              <div className="status-map">
                <div className="status-map-row"><strong>External ID</strong><span>required · unique per board</span></div>
                <div className="status-map-row"><strong>Title</strong><span>required · 1–200 chars</span></div>
                <div className="status-map-row"><strong>Description</strong><span>optional · 20,000 chars</span></div>
                <div className="status-map-row"><strong>Priority</strong><span>none/low/medium/high/urgent</span></div>
                <div className="status-map-row"><strong>Due Date</strong><span>date-only · YYYY-MM-DD</span></div>
                <div className="status-map-row"><strong>Assignees</strong><span>active project people only</span></div>
                <div className="status-map-row"><strong>Status</strong><span>existing column name</span></div>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">Atomic commit</h2><p className="panel-sub">No partial success</p></div></div>
            <div className="panel-body stack-sm">
              <div className="hub-coverage-item"><Icon name="check" /><span><strong>All rows valid</strong> means every nonempty row is ready.</span></div>
              <div className="hub-coverage-item"><Icon name="x" /><span><strong>One invalid or conflicting row</strong> blocks the entire batch.</span></div>
              <div className="hub-coverage-item"><Icon name="refresh" /><span><strong>Fixing rows</strong> means editing the workbook and uploading again. There is no partial retry.</span></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">What does not import</h2></div></div>
            <div className="panel-body stack-sm">
              <div className="hub-coverage-item"><Icon name="x" /><span>Comments, mentions or activity history.</span></div>
              <div className="hub-coverage-item"><Icon name="x" /><span>Images or image URLs.</span></div>
              <div className="hub-coverage-item"><Icon name="x" /><span>Projects, boards, people, grants or roles.</span></div>
              <div className="hub-coverage-item"><Icon name="x" /><span>Card keys. The server assigns those.</span></div>
              <div className="note"><Icon name="lock" /><span>Unknown people or statuses block the batch. The importer never creates accounts or silently falls back to a default person.</span></div>
            </div>
          </section>
        </aside>
      </div>

      <DialogLayer open={commitOpen} onClose={() => setCommitOpen(false)} labelledBy="commitTitle" className="wide">
        <div className="dialog-head">
          <div className="dialog-head-copy"><h2 id="commitTitle">Create these cards?</h2><p>This commits the whole batch. If anything changed on the server, nothing is created.</p></div>
          <button className="dialog-close" type="button" onClick={() => setCommitOpen(false)} aria-label="Close import confirmation"><Icon name="x" /></button>
        </div>
        <div className="dialog-body">
          {status && <Summary status={status} />}
          <div className="note" style={{ marginTop: 12 }}><Icon name="board" /><span>Cards are appended to their mapped columns. The board&apos;s manual order is preserved; imported cards are not silently interleaved.</span></div>
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="btn" type="button" onClick={() => setCommitOpen(false)}>Cancel</button>
          <button className="btn primary" type="button" data-autofocus disabled={busy} onClick={() => void commit()}><Icon name="upload" />{busy ? 'Creating…' : 'Confirm import'}</button>
        </footer>
      </DialogLayer>
    </div>
  );
}

export default function ImportPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading import…</div>}><ImportScreen /></Suspense>;
}
