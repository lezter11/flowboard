import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, LockKeyhole } from 'lucide-react';

type Crumb = { label: string; href?: string };

export function MissingRouteFrame({
  eyebrow,
  title,
  description,
  crumbs,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 py-7 sm:py-10 space-y-8">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="text-xs text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            {crumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="text-faint">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="rounded-sm hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{crumb.label}</Link>
                ) : (
                  <span aria-current="page" className="font-semibold text-ink">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <header className="border-b border-line pb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm sm:text-base leading-7 text-muted">{description}</p>
      </header>
      {children}
    </div>
  );
}

export function MissingRouteNotice({
  title,
  children,
  backHref = '/projects',
  backLabel = 'Browse projects',
}: {
  title: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <section aria-labelledby="route-notice-title" className="rounded-2xl border border-accent-line bg-accent-soft/60 p-5 sm:p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-line bg-surface text-accent">
          <LockKeyhole aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 id="route-notice-title" className="text-base font-bold text-ink">{title}</h2>
          <div className="mt-1 text-sm leading-6 text-ink-soft">{children}</div>
          <Link href={backHref} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />{backLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function MissingRouteAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="space-y-2">
      <button type="button" disabled aria-describedby={`${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-reason`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink opacity-50 cursor-not-allowed">
        {label}
      </button>
      <p id={`${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-reason`} className="text-xs leading-5 text-muted">{reason}</p>
    </div>
  );
}
