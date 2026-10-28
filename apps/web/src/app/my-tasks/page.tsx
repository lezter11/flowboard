import type { Metadata } from 'next';
import { CalendarDays, CircleCheck, Clock3, ListTodo } from 'lucide-react';
import { MissingRouteFrame, MissingRouteNotice } from '@/components/missing-route-frame';

export const metadata: Metadata = { title: 'My tasks — Flowboard' };

export default function MyTasksPage() {
  return (
    <MissingRouteFrame eyebrow="Your work" title="My tasks" description="A personal queue for cards assigned to you across the projects and boards you can open." crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'My tasks' }]}>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Clock3, label: 'Overdue', tone: 'bg-danger-soft text-danger' },
          { icon: CalendarDays, label: 'Due today', tone: 'bg-accent-soft text-accent' },
          { icon: CircleCheck, label: 'Completed', tone: 'bg-completed-bg text-completed-text' },
        ].map(({ icon: Icon, label, tone }) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon aria-hidden="true" className="h-5 w-5" /></span>
            <span className="text-sm font-semibold text-ink">{label}</span>
            <span className="ml-auto text-xs text-faint">Unavailable</span>
          </div>
        ))}
      </div>
      <section aria-labelledby="task-queue-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-7 shadow-sm">
        <h2 id="task-queue-title" className="text-lg font-bold text-ink">Your queue</h2>
        <div className="mt-5 flex min-h-52 flex-col items-center justify-center border-t border-line px-4 py-8 text-center">
          <ListTodo aria-hidden="true" className="h-9 w-9 text-accent" />
          <p className="mt-4 font-semibold text-ink">Assigned cards are not available yet</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">The personal task API has no approved integration contract. Counts and filters are withheld so an incomplete list is never mistaken for your full workload.</p>
        </div>
      </section>
      <MissingRouteNotice title="Task data is waiting for integration">Browse projects for the available project navigation. Assigned work will link back to its source board after the scoped task endpoint is ready.</MissingRouteNotice>
    </MissingRouteFrame>
  );
}
