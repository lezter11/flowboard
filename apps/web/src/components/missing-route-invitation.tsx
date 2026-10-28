import Link from 'next/link';
import { MailCheck, ShieldAlert } from 'lucide-react';
import { MissingRouteAction } from '@/components/missing-route-frame';

export function MissingRouteInvitation() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas px-5 py-8 text-ink sm:px-8">
      <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center">
        <Link href="/projects" className="mb-12 w-fit rounded-sm text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">Flow<span className="brand-wordmark">board</span></Link>
        <div className="rounded-3xl border border-line bg-surface p-6 shadow-lg sm:p-9">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent"><MailCheck aria-hidden="true" className="h-7 w-7" /></span>
          <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-accent">Project invitation</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Invitation link</h1>
          <p className="mt-4 text-sm leading-7 text-muted">We cannot check this invitation in the current web preview. Project name, role, and inviter details remain hidden until the server validates the link and your signed-in email.</p>
          <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4 text-sm leading-6 text-ink-soft"><ShieldAlert aria-hidden="true" className="mb-2 h-5 w-5 text-accent" />An invitation can be expired, revoked, already used, or intended for another email address. The server must decide which state applies.</div>
          <div className="mt-7"><MissingRouteAction label="Accept invitation" reason="Acceptance is unavailable until safe invitation preview, account verification, and the reviewed acceptance flow are connected." /></div>
        </div>
        <Link href="/signin" className="mt-6 w-fit rounded-sm text-sm font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Go to sign in</Link>
      </main>
    </div>
  );
}
