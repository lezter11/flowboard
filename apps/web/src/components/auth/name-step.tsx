'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionData } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { checkName, initialName } from '@/lib/name-form';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';

/**
 * The one-time "What should we call you?" step (B-16). It replaces whatever page the person was heading to, without
 * changing the address, so when the name is saved the same page (an invitation link included) simply renders again.
 * Google's given and family name arrive as suggestions only and are never saved without the person pressing Continue.
 */
export function NameStep({ session }: { session: SessionData }) {
  const queryClient = useQueryClient();
  const { signOut } = useSession();
  const start = initialName(session);
  const [first, setFirst] = useState(start.first);
  const [last, setLast] = useState(start.last);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);
  const check = checkName(first, last);
  const showFirst = touched && check.errors.firstName;
  const showLast = touched && check.errors.lastName;

  useEffect(() => { firstRef.current?.focus(); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    setServerError('');
    if (!check.ok || check.firstName === null || check.lastName === null) {
      (check.errors.firstName ? firstRef : lastRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api.saveName({ firstName: check.firstName, lastName: check.lastName });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (error) {
      setServerError(error instanceof ApiError && error.status === 422 ? 'We could not use that name. Check both fields and try again.' : describeError(error));
      setBusy(false);
    }
  };

  return (
    <div className="invite-shell name-shell">
      <header className="invite-top">
        <span className="brand brand-on-light" aria-label="Flowboard"><Wordmark mark outline /></span>
        <span className="spacer" />
        <button className="btn ghost sm" type="button" onClick={() => void signOut()}>Sign out</button>
      </header>
      <main className="invite-main" id="main">
        <div>
          <article className="invite-card name-card">
            <div className="invite-banner">
              <div className="invite-hero">
                <div className="invite-art name-art" aria-hidden="true">
                  <svg viewBox="0 0 76 76"><circle className="art-ring" cx="38" cy="38" r="28" /><circle className="art-bubble-dot b" cx="38" cy="31" r="8" /><path className="art-bubble-dot b" d="M23 55a15 15 0 0 1 30 0z" /></svg>
                </div>
                <p className="eyebrow">One quick thing</p>
              </div>
              <h1>What should we call you?</h1>
              <p>Teammates see this name on cards, comments and invitations. You can change it later in Settings.</p>
            </div>
            <form className="invite-body name-form" onSubmit={submit} noValidate>
              <div className="name-fields">
                <div className="field">
                  <label className="field-label" htmlFor="nameFirst">First name</label>
                  <input ref={firstRef} className="control" id="nameFirst" name="given-name" autoComplete="given-name" value={first} onChange={(event) => { setFirst(event.target.value); setServerError(''); }} aria-invalid={showFirst ? true : undefined} aria-describedby={showFirst ? 'nameFirstError' : undefined} />
                  {showFirst && <p className="form-error" id="nameFirstError" role="alert">{check.errors.firstName}</p>}
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="nameLast">Last name</label>
                  <input ref={lastRef} className="control" id="nameLast" name="family-name" autoComplete="family-name" value={last} onChange={(event) => { setLast(event.target.value); setServerError(''); }} aria-invalid={showLast ? true : undefined} aria-describedby={showLast ? 'nameLastError' : undefined} />
                  {showLast && <p className="form-error" id="nameLastError" role="alert">{check.errors.lastName}</p>}
                </div>
              </div>
              {(session.suggestedFirstName || session.suggestedLastName) && <p className="name-hint">We filled this in from your Google account. Change it if it is not how you want to appear.</p>}
              {serverError && <div className="auth-note danger invite-state-note" role="alert"><Icon name="x-circle" /><span><strong>Could not save</strong> {serverError}</span></div>}
              <div className="invite-actions">
                <button className="btn primary" type="submit" disabled={busy}><Icon name="check-circle" /> {busy ? 'Saving…' : 'Continue'}</button>
              </div>
              <div className="invite-privacy"><Icon name="lock" /><span>Signed in as {session.actor.email}. Only people you share a project with can see your name.</span></div>
            </form>
          </article>
        </div>
      </main>
    </div>
  );
}
