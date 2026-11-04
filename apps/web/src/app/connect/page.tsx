'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { HostedMcpAuthorizationView } from '@flowboard/contracts';
import { useSession } from '@/lib/session';
import { accessFingerprint } from '@/lib/session-state';
import { ApiError } from '@/lib/api';
import { hostedMcpApi } from '@/lib/hosted-mcp-api';
import { authorizationRequestId, CONNECTION_PERMISSIONS, mergeAuthorizationPage, safeHostedMcpRedirect } from '@/lib/hosted-mcp-state';
import { Wordmark } from '@/components/ui/wordmark';
import { ErrorNote } from '@/components/ui/error-note';
import { GoogleSignIn } from '@/components/auth/google-sign-in';
import { ConnectionDuration } from '@/components/integrations/connection-duration';

function Unavailable() {
  return <section className="connect-section" aria-labelledby="connectUnavailable">
    <h1 id="connectUnavailable">Connection request unavailable</h1>
    <p>This request expired, ended or cannot be opened. Return to your connector app and start again.</p>
    <Link className="btn" href="/settings?tab=connections">View your connections</Link>
  </section>;
}

function Consent({ requestId, email }: { requestId: string; email: string }) {
  const { refetch } = useSession();
  const [view, setView] = useState<HostedMcpAuthorizationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const initial = useRef<Promise<HostedMcpAuthorizationView> | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  const failure = (err: unknown) => {
    if (!alive.current) return;
    setView(null); setSelected(''); setError(err); setLoading(false);
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) refetch();
      if (err.retryAfter) setRetryUntil(Date.now() + err.retryAfter * 1000);
    }
  };
  useEffect(() => {
    alive.current = true;
    let active = true;
    // Reuse the same request across React's development effect replay. GET rotates CSRF.
    const promise = initial.current ??= hostedMcpApi.authorization(requestId);
    void promise.then(next => { if (active) { setView(next); setLoading(false); } }).catch(err => { if (active) failure(err); });
    return () => { active = false; alive.current = false; };
  }, [requestId]);
  useEffect(() => {
    if (!view) return;
    const timeout = setTimeout(() => failure(new ApiError(404, 'MCP_REQUEST_UNAVAILABLE', 'Request ended.')), Math.max(0, Date.parse(view.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [view?.expiresAt]);
  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);
  const load = async (cursor?: string) => {
    if (submitting.current || loading || Date.now() < retryUntil) return;
    setLoading(true); setError(null);
    try {
      const next = await hostedMcpApi.authorization(requestId, cursor);
      if (!alive.current) return;
      setView(cursor && view ? mergeAuthorizationPage(view, next) : next);
      if (!cursor) setSelected('');
    } catch (err) { failure(err); }
    finally { if (alive.current) setLoading(false); }
  };
  const decide = async (decision: 'allow' | 'deny') => {
    if (!view || loading || submitting.current || (decision === 'allow' && !selected)) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const result = await hostedMcpApi.decide(requestId, { decision, csrfToken: view.csrfToken, ...(decision === 'allow' ? { projectId: selected } : {}) });
      if (!alive.current) return;
      const target = safeHostedMcpRedirect(result.redirectUrl, window.location.origin);
      if (!target) throw new ApiError(502, 'MCP_INVALID_RESPONSE', 'Unexpected completion.');
      // This value comes only from the authenticated, validated decision response.
      window.location.assign(target);
    } catch (err) {
      if (!alive.current) return;
      const uncertain = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      setUnknown(uncertain);
      failure(uncertain ? new ApiError(0, 'MCP_UNKNOWN_OUTCOME', 'Could not confirm.') : err);
      submitting.current = false; setBusy(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void decide('allow'); };
  if (!view) {
    if (loading) return <div className="connect-section" role="status">Loading connection request…</div>;
    if (error instanceof ApiError && error.status === 404) return <Unavailable />;
    return <section className="connect-section"><h1>{unknown ? 'We could not confirm the result' : 'Could not open this connection'}</h1>
      <ErrorNote error={error} />
      <div className="connect-actions">
        {!unknown && <button className="btn" type="button" onClick={() => void load()} disabled={now < retryUntil}>Reload request</button>}
        <Link className="btn" href="/settings?tab=connections">View your connections</Link>
      </div>
    </section>;
  }
  const project = view.projects.find(p => p.id === selected);
  return <>
    <section className="connect-section" data-testid="client-identity">
      <p className="eyebrow">App connection</p>
      <h1>Connect {view.client.name} to Flowboard</h1>
      <p className="connect-account">Signed in as <strong>{email}</strong></p>
      <dl className="connection-origins"><div><dt>App origin</dt><dd>{view.client.origin}</dd></div><div><dt>Returns to</dt><dd>{view.client.redirectOrigin}</dd></div></dl>
      <div className="note warn" data-testid="client-unverified"><span><strong>Unverified app.</strong> Flowboard has not verified this app’s identity. Continue only if you intended to connect it.</span></div>
    </section>
    <form onSubmit={submit}>
      <section className="connect-section">
        <h2>Choose its access</h2>
        <div className="field">
          <label className="field-label" htmlFor="connectionProject">Choose one project</label>
          <select className="control" id="connectionProject" value={selected} required disabled={busy || loading} onChange={event => setSelected(event.target.value)} aria-describedby="connectionProjectHelp">
            <option value="">Select a project</option>
            {view.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="field-help" id="connectionProjectHelp">Only this project can be used. Access follows your current project role and board access.</p>
          {project?.role === 'viewer' && <p className="field-help">Your Viewer role can read cards but cannot create them.</p>}
          {!view.projects.length && !view.nextCursor && <p role="status">No projects are available. You can deny this request and return to the connector.</p>}
          {view.nextCursor && <button className="btn sm" type="button" disabled={loading || busy} onClick={() => void load(view.nextCursor!)}>{loading ? 'Loading projects…' : 'Load more projects'}</button>}
        </div>
        <ul className="connection-permissions" data-testid="connection-permissions">{view.scopes.map(scope => <li key={scope}>{CONNECTION_PERMISSIONS[scope]}</li>)}</ul>
        <ConnectionDuration offlineAccess={view.offlineAccess} />
        <p className="field-help">You can disconnect this app in Settings → Connections. Signing out of Flowboard does not disconnect an approved app.</p>
      </section>
      <footer className="connect-section connect-actions">
        <button className="btn" type="button" disabled={busy || loading} onClick={() => void decide('deny')}>Deny</button>
        <button className="btn primary" type="submit" disabled={busy || loading || !selected}>{busy ? 'Finishing…' : 'Allow connection'}</button>
        {busy && <span role="status" className="sr-only">Finishing your connection request…</span>}
      </footer>
    </form>
  </>;
}

function ConnectScreen() {
  const params = useSearchParams();
  const { state, refetch } = useSession();
  const [requestId, setRequestId] = useState<string | null | undefined>(undefined);
  useEffect(() => { setRequestId(authorizationRequestId(window.location.search)); }, [params]);
  let content;
  if (requestId === undefined || state.status === 'loading') content = <div className="connect-section" role="status">Loading connection request…</div>;
  else if (!requestId) content = <Unavailable />;
  else if (state.status === 'signedOut') content = <section className="connect-section">
    <p className="eyebrow">App connection</p><h1>Connect to Flowboard</h1>
    <p id="connectSigninNote">Sign in to choose the project this connection can use.</p>
    <GoogleSignIn href={`/api/v1/auth/google/start?next=${encodeURIComponent(`/connect?request=${requestId}`)}`} describedBy="connectSigninNote" />
    <p className="field-help">You will review the app and its permissions before allowing access.</p>
  </section>;
  else if (state.status === 'error') content = <section className="connect-section"><h1>Flowboard isn’t reachable</h1><p>Try again to check your session.</p><button className="btn" onClick={refetch}>Try again</button></section>;
  else content = <Consent key={`${accessFingerprint(state)}:${requestId}`} requestId={requestId} email={state.session.actor.email} />;
  return <div className="connect-page" data-page="connect">
    <a className="skip-link" href="#connectMain">Skip to connection request</a>
    <header className="connect-top"><Link href="/projects" aria-label="Flowboard"><Wordmark mark outline /></Link></header>
    <main className="connect-main" id="connectMain"><article className="connect-panel">{content}</article></main>
  </div>;
}

export default function ConnectPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading connection request…</div>}><ConnectScreen /></Suspense>;
}
