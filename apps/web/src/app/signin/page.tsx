'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Kanban, LockKeyhole, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';

export default function SignInPage() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [customEmail, setCustomEmail] = useState('');
  const [error, setError] = useState('');

  const handleDevLogin = async (role: string, email?: string) => {
    try {
      setLoadingRole(role);
      setError('');
      const userEmail = email || `${role.toLowerCase()}@flowboard.example`;
      const res = await fetch('/api/v1/session/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-Secret': 'flowboard-dev-secret',
        },
        body: JSON.stringify({
          email: userEmail,
          displayName: `${role.charAt(0).toUpperCase() + role.slice(1)} User`,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Sign in failed with status ${res.status}`);
      }

      router.push('/projects');
    } catch (err: any) {
      setError(err?.message || 'Dev sign in failed.');
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas text-ink">
      <main className="min-h-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <section className="flex flex-col px-6 py-8 sm:px-10 lg:px-16 xl:px-24">
          <Link
            href="/projects"
            className="inline-flex w-fit items-center gap-2 rounded-sm text-base font-bold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            aria-label="Flowboard projects"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-surface">
              <Kanban aria-hidden="true" className="h-5 w-5" />
            </span>
            Flow<span className="brand-wordmark -ml-2">board</span>
          </Link>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Welcome back</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-[2.75rem]">
              Sign in to <span className="brand-wordmark">Flowboard</span>
            </h1>
            <p className="mt-4 text-base leading-7 text-muted">
              Your project boards, assigned cards, and team discussions live in one private workspace.
            </p>

            {error && (
              <div role="alert" className="mt-6 p-3.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
                {error}
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-md space-y-5">
              <div>
                <h2 className="text-base font-semibold">Production Sign In</h2>
                <p className="mt-1 text-xs text-muted">Authenticate securely with your corporate Google Account.</p>
              </div>

              {/* Real Google OAuth Redirect */}
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/auth/google`}
                className="w-full inline-flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-ink text-surface font-semibold text-xs sm:text-sm hover:opacity-95 shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </a>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-line"></div>
                <span className="flex-shrink mx-3 text-[11px] uppercase font-bold text-muted">or dev testing persona</span>
                <div className="flex-grow border-t border-line"></div>
              </div>

              {/* Dev Persona Shortcuts */}
              <div className="space-y-2">
                <p className="text-[11px] text-muted">Quick test personas (enabled in development/test):</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDevLogin('owner', 'alice@flowboard.example')}
                    disabled={!!loadingRole}
                    className="p-2 rounded-lg border border-line bg-surface-2 text-center text-xs font-semibold hover:border-line-strong hover:bg-surface-3 transition-colors disabled:opacity-50"
                  >
                    👑 Alice (Owner)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDevLogin('manager', 'bob@flowboard.example')}
                    disabled={!!loadingRole}
                    className="p-2 rounded-lg border border-line bg-surface-2 text-center text-xs font-semibold hover:border-line-strong hover:bg-surface-3 transition-colors disabled:opacity-50"
                  >
                    💼 Bob (Manager)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDevLogin('member', 'charlie@flowboard.example')}
                    disabled={!!loadingRole}
                    className="p-2 rounded-lg border border-line bg-surface-2 text-center text-xs font-semibold hover:border-line-strong hover:bg-surface-3 transition-colors disabled:opacity-50"
                  >
                    🛠️ Charlie (Dev)
                  </button>
                </div>
              </div>

              {/* Custom email dev login */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (customEmail.trim()) handleDevLogin('custom', customEmail.trim());
                }}
                className="flex gap-2 pt-1"
              >
                <input
                  type="email"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-line bg-surface text-xs placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                />
                <button
                  type="submit"
                  disabled={!customEmail.trim() || !!loadingRole}
                  className="px-3 py-1.5 rounded-lg bg-surface-3 border border-line text-xs font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50"
                >
                  Dev Login
                </button>
              </form>
            </div>

            <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted">
              <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              Flowboard opens project data only after the server verifies your account and board-level access.
            </p>
          </div>

          <p className="text-xs text-faint">Flowboard · Private project work</p>
        </section>

        <aside className="hidden lg:flex flex-col justify-center border-l border-line bg-rail px-12 xl:px-20">
          <div className="max-w-lg rounded-[28px] border border-line bg-surface p-7 shadow-lg">
            <div className="flex items-center justify-between border-b border-line pb-5">
              <span className="text-sm font-bold">A clearer path through team work</span>
              <Kanban aria-hidden="true" className="h-5 w-5 text-accent" />
            </div>
            <div className="mt-6 space-y-3">
              {['Keep every board within its project', '1-Click multi-board unified view', 'Follow updates and assigned cards in one place'].map(
                (item, index) => (
                  <div key={item} className="flex items-center gap-4 rounded-xl border border-line bg-surface-2 px-4 py-4">
                    <span className="font-mono text-xs font-bold text-accent">0{index + 1}</span>
                    <span className="text-sm font-medium">{item}</span>
                  </div>
                ),
              )}
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-accent" />
              Project and board access is verified on every request.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
