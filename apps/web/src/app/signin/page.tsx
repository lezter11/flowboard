'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Wordmark } from '@/components/ui/wordmark';
import { BoardPreview } from '@/components/signin/board-preview';

const MESSAGES: Record<string, string> = {
  'callback-error': 'Google sign-in could not be completed. Try again.',
  expired: 'Your session expired. Sign in again to continue.',
  denied: 'This account does not have access. Ask the project owner or manager for an invitation.',
};

/** Compiled out of production builds: NODE_ENV is inlined by Next, so the dev-login code below is dead code there. */
const DEV_LOGIN = process.env.NODE_ENV !== 'production';

function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  // ?next= is only handed to the API, which validates it and does the redirecting after sign-in.
  const next = params.get('next');
  const googleHref = next ? `/api/v1/auth/google/start?next=${encodeURIComponent(next)}` : '/api/v1/auth/google/start';
  const alertText = MESSAGES[params.get('state') ?? ''] ?? '';
  const [devEmail, setDevEmail] = useState('');
  const [devError, setDevError] = useState('');
  const [busy, setBusy] = useState(false);

  // Theme: the layout's pre-paint script already applied the saved choice, else dark (lib/theme.ts).
  // The OS colour scheme is deliberately ignored, as everywhere else in the app. ?palette= is the prototype's review switch.
  useEffect(() => {
    const root = document.documentElement;
    const palette = params.get('palette');
    root.dataset.palette = palette && /^[123]$/.test(palette) ? palette : '1';
    return () => { delete root.dataset.palette; };
  }, [params]);

  const devLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!DEV_LOGIN || !devEmail.trim()) return;
    setBusy(true);
    setDevError('');
    try {
      const secret = process.env.NEXT_PUBLIC_DEV_LOGIN_SECRET;
      const res = await fetch('/api/v1/session/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Dev-Secret': secret } : {}) },
        body: JSON.stringify({ email: devEmail.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Sign in failed with status ${res.status}`);
      }
      await queryClient.resetQueries({ queryKey: ['session'] });
      router.push('/projects');
    } catch (error) {
      setDevError(error instanceof Error ? error.message : 'Dev sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-page" data-page="signin">
      <a className="skip-link" href="#signinMain">Skip to sign in</a>
      <main className="signin-shell" id="signinMain">
        <section className="signin-panel" aria-labelledby="signinTitle">
          <a className="signin-brand" href="/projects" aria-label="Flowboard">
            <Wordmark inline mark outline />
          </a>

          <div className="signin-content">
            <p className="signin-kicker">Welcome back</p>
            <h1 id="signinTitle">Sign in with <Wordmark inline outline /></h1>

            <a className="signin-google" id="googleSignIn" href={googleHref} aria-describedby="signinNote">
              <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M43.611 20.083H42V20H24v8h11.303a12 12 0 0 1-4.193 6.257v5.146h6.785c3.973-3.662 6.267-9.053 6.267-15.403 0-1.354-.131-2.657-.551-3.917Z" />
                <path fill="#34A853" d="M24 44c5.67 0 10.423-1.882 13.895-5.097l-6.785-5.146c-1.882 1.265-4.289 2.018-7.11 2.018-5.47 0-10.11-3.693-11.766-8.658H5.24v5.307A20.98 20.98 0 0 0 24 44Z" />
                <path fill="#FBBC05" d="M12.234 27.117a12.58 12.58 0 0 1 0-8.234v-5.307H5.24a20.99 20.99 0 0 0 0 18.848l6.994-5.307Z" />
                <path fill="#EA4335" d="M24 8.225c3.09 0 5.862 1.063 8.045 3.15l6.036-6.036C34.414 1.995 29.663 0 24 0A20.98 20.98 0 0 0 5.24 13.576l6.994 5.307C13.89 11.918 18.53 8.225 24 8.225Z" />
              </svg>
              <span>Continue with Google</span>
            </a>

            <p className="signin-note" id="signinNote">Flowboard opens project data only after the server verifies your account.</p>
            <p className="signin-alert" id="signinAlert" role="alert" hidden={!alertText}>{alertText}</p>

            {DEV_LOGIN && (
              <form onSubmit={devLogin} className="dialog-field" aria-label="Local development sign-in">
                <label htmlFor="devEmail">Local development sign-in (not in production)</label>
                <input className="control" id="devEmail" type="email" placeholder="name@example.com" value={devEmail} onChange={(event) => setDevEmail(event.target.value)} />
                <button className="btn" type="submit" disabled={busy || !devEmail.trim()}>Dev sign in</button>
                {devError && <span className="field-error" role="alert">{devError}</span>}
              </form>
            )}
          </div>
        </section>

        <BoardPreview />
      </main>
    </div>
  );
}

export default function SignInPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading…</div>}><SignInScreen /></Suspense>;
}
