'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HostedMcpConnection } from '@flowboard/contracts';
import { hostedMcpApi } from '@/lib/hosted-mcp-api';
import { CONNECTION_PERMISSIONS } from '@/lib/hosted-mcp-state';
import { useSession } from '@/lib/session';
import { ErrorNote } from '@/components/ui/error-note';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ConnectionDuration } from './connection-duration';
import { McpPromptHelp } from './mcp-prompt-help';

const timestamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ConnectionsPanel({ actorId }: { actorId: string }) {
  const { refetch: refetchSession } = useSession();
  const query = useQuery({ queryKey: ['hosted-connections', actorId], queryFn: () => hostedMcpApi.connections(), enabled: !!actorId, retry: false, staleTime: 0, refetchOnWindowFocus: true });
  const connector = useQuery({ queryKey: ['hosted-connector-url'], queryFn: () => hostedMcpApi.connectorUrl(), retry: false });
  const [selected, setSelected] = useState<HostedMcpConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (query.isError) { setSelected(null); refetchSession(); } }, [query.isError]);
  const disconnect = async () => {
    if (!selected || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      await hostedMcpApi.disconnect(selected.id);
      if (!alive.current) return;
      setSelected(null); setNotice('App access disconnected.');
      await query.refetch();
      requestAnimationFrame(() => heading.current?.focus());
    } catch (err) { if (alive.current) { setError(err); refetchSession(); } }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  };
  const copyUrl = async () => {
    if (!connector.data || connector.isError) return;
    try { await navigator.clipboard.writeText(connector.data); setCopied(true); setCopyFailed(false); }
    catch { setCopied(false); setCopyFailed(true); }
  };
  // A refused refresh must hide old grants, even when React Query retains stale data.
  const connections = query.isError ? [] : query.data ?? [];
  return <section className="panel" id="panel-connections" role="tabpanel" aria-labelledby="tab-connections">
    <div className="panel-head"><div className="panel-head-copy">
      <h2 className="panel-title" ref={heading} tabIndex={-1}>App connections</h2>
      <p className="panel-sub">Apps you allowed to use one of your projects.</p>
    </div></div>
    <div className="panel-body stack">
      <div className="note"><span>In your connector app, add a custom connector with the Flowboard URL. Sign in, choose one project, then allow the connection.</span></div>
      <div className="field"><label className="field-label" htmlFor="connectorUrl">Connector URL</label><input className="control" id="connectorUrl" type="url" readOnly value={connector.isError ? '' : connector.data ?? ''} aria-describedby="connectorUrlHelp" /></div>
      <div className="row connection-url"><button className="btn" type="button" disabled={!connector.data || connector.isError} onClick={() => void copyUrl()}>{copied ? 'URL copied' : 'Copy Flowboard URL'}</button><span className="field-help" id="connectorUrlHelp">{connector.isError ? 'The connector URL is unavailable. Ask the Flowboard administrator to check its setup.' : 'Copy the connector URL published by this Flowboard.'}</span></div>
      {copyFailed && <p role="status">Copy was blocked. Select the URL above and copy it.</p>}
      <McpPromptHelp />
      {notice && <p role="status">{notice}</p>}
      {query.isPending && <p role="status">Loading your connections…</p>}
      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}
      {!query.isPending && !query.isError && !connections.length && <div className="connection-empty"><h3>No app connections yet</h3><p>Add the Flowboard URL in your connector app to connect a project.</p></div>}
      <ul className="connection-list" data-testid="connection-list" aria-label="Your app connections">
        {connections.map(connection => <li key={connection.id} className="connection-entry" data-connection-id={connection.id}>
          <div className="connection-entry-head"><div><h3>{connection.clientName}</h3><p>{connection.projectName}</p></div><button className="btn sm" type="button" onClick={() => { setError(null); setSelected(connection); }}>Disconnect</button></div>
          <dl className="connection-origins"><div><dt>App origin</dt><dd>{connection.clientOrigin}</dd></div><div><dt>Returns to</dt><dd>{connection.redirectOrigin}</dd></div></dl>
          <p className="field-help">App identity is unverified. Approval does not confirm the app has connected.</p>
          <ul className="connection-permissions">{connection.scopes.map(scope => <li key={scope}>{CONNECTION_PERMISSIONS[scope]}</li>)}</ul>
          <ConnectionDuration offlineAccess={connection.offlineAccess} />
          <dl className="connection-dates"><div><dt>Approved</dt><dd><time dateTime={connection.createdAt}>{timestamp(connection.createdAt)}</time></dd></div><div><dt>Connection record expires</dt><dd><time dateTime={connection.expiresAt}>{timestamp(connection.expiresAt)}</time></dd></div><div><dt>Last used</dt><dd>{connection.lastUsedAt ? <time dateTime={connection.lastUsedAt}>{timestamp(connection.lastUsedAt)}</time> : 'Not recorded'}</dd></div></dl>
        </li>)}
      </ul>
    </div>
    <DialogLayer open={!!selected} onClose={() => { if (!busy) setSelected(null); }} labelledBy="disconnectTitle" describedBy="disconnectCopy">
      <div className="dialog-head"><div className="dialog-head-copy"><h2 id="disconnectTitle">Disconnect app?</h2></div></div>
      <div className="dialog-body">
        <p id="disconnectCopy" className="confirm-copy">Disconnect {selected?.clientName} from {selected?.projectName}? This app will no longer be able to read or create cards using this connection. Cards it already created will remain.</p>
        {error != null && <ErrorNote error={error} focusOnMount />}
      </div>
      <footer className="dialog-foot"><button className="btn" type="button" data-autofocus disabled={busy} onClick={() => setSelected(null)}>Keep connection</button><button className="btn danger" type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect'}</button></footer>
    </DialogLayer>
  </section>;
}
