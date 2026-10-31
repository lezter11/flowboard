/**
 * What the sign-in page says for /signin?state=… (the Google callback redirects there; the browser never sees JSON).
 * Plain text only: nothing from the URL is echoed, so a crafted link cannot put words on the page.
 */
export interface SigninNote { title: string; body: string }

const STATES: Record<string, SigninNote> = {
  denied: { title: 'Google did not give us access', body: 'You can try again, or use a different Google account.' },
  expired: { title: 'Sign-in took too long', body: 'Start again with the button below.' },
  failed: { title: 'Google sign-in did not finish', body: 'Try again.' },
  email_unverified: { title: 'Verify your Google email first', body: 'Google says your email is not verified. Verify it in your Google account, then sign in again.' },
  email_missing: { title: 'Your Google account has no email', body: 'Flowboard needs an email address to sign you in. Use a Google account that has one.' },
  // Older links and the session gate still use these two.
  'callback-error': { title: 'Google sign-in did not finish', body: 'Try again.' },
  session_ended: { title: 'Your session ended', body: 'Sign in again to keep working.' },
};

export const signinNote = (state: string | null | undefined): SigninNote | null => (state && Object.hasOwn(STATES, state) ? STATES[state]! : null);
export const SIGNIN_STATES = Object.keys(STATES);
