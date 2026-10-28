import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, ShieldCheck, UploadCloud } from 'lucide-react';
import { MissingRouteAction, MissingRouteFrame, MissingRouteNotice } from '@/components/missing-route-frame';

export function MissingRouteImport({ projectId }: { projectId?: string }) {
  const projectHref = projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects';
  return (
    <MissingRouteFrame eyebrow="Create-only XLSX" title="Import cards" description="Upload a workbook, check every row, then confirm the complete batch before any card is created." crumbs={[{ label: 'Projects', href: '/projects' }, ...(projectId ? [{ label: 'Project', href: projectHref }] : []), { label: 'Import cards' }]}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
        <section aria-labelledby="import-step-title" className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
          <h2 id="import-step-title" className="text-lg font-bold">Import process</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {[['1', 'Upload', 'Choose an XLSX workbook.'], ['2', 'Preview', 'Correct every blocking row error.'], ['3', 'Confirm', 'Create the whole batch together.']].map(([number, title, copy]) => (
              <li key={number} className="rounded-xl border border-line bg-surface-2 p-4"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-bold text-accent">{number}</span><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted">{copy}</p></li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-canvas p-6 text-center">
            <UploadCloud aria-hidden="true" className="mx-auto h-8 w-8 text-accent" />
            <p className="mt-3 text-sm font-semibold">Workbook upload is unavailable</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">File parsing, preview, and atomic commit must be connected to the reviewed project and board import contract.</p>
            <div className="mt-5"><MissingRouteAction label="Choose XLSX file" reason="No file is selected or sent while import integration is pending." /></div>
          </div>
        </section>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-5"><FileSpreadsheet aria-hidden="true" className="h-6 w-6 text-accent" /><h2 className="mt-3 font-semibold">Workbook format</h2><p className="mt-2 text-sm leading-6 text-muted">Cards use seven columns: External ID, Title, Description, Priority, Due Date, Assignees, and Status. A priority must be chosen for every new card.</p><p className="mt-3 text-xs leading-5 text-muted">Template download will be offered after the approved workbook is packaged with the web app.</p></section>
          <section className="rounded-2xl border border-line bg-surface p-5"><ShieldCheck aria-hidden="true" className="h-6 w-6 text-accent" /><h2 className="mt-3 font-semibold">Whole batch only</h2><p className="mt-2 text-sm leading-6 text-muted">Import creates new cards. It does not update existing cards or partially commit a batch with row errors.</p></section>
        </aside>
      </div>
      <MissingRouteNotice title="Import is waiting for live integration" backHref={projectHref} backLabel={projectId ? 'Back to project' : 'Browse projects'}>Only an Owner or Project Manager may import into an accessible project. The server checks that permission again before committing a preview.</MissingRouteNotice>
      <Link href={projectHref} className="inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{projectId ? 'Back to project' : 'Browse projects'}</Link>
    </MissingRouteFrame>
  );
}
