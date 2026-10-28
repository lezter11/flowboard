import Link from 'next/link';
import { Hourglass } from 'lucide-react';

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 p-6 sm:p-10 max-w-3xl mx-auto w-full">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent flex items-center gap-2">
        <Hourglass className="h-4 w-4" aria-hidden="true" /> Coming soon
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 text-sm text-muted">{description}</p>
      <Link href="/projects" className="mt-6 inline-flex rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-3 focus-visible:outline-2">
        Back to projects
      </Link>
    </div>
  );
}
