export function GoogleSignIn({ href, describedBy }: { href: string; describedBy?: string }) {
  return <a className="signin-google" id="googleSignIn" href={href} aria-describedby={describedBy}>
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M43.611 20.083H42V20H24v8h11.303a12 12 0 0 1-4.193 6.257v5.146h6.785c3.973-3.662 6.267-9.053 6.267-15.403 0-1.354-.131-2.657-.551-3.917Z" />
      <path fill="#34A853" d="M24 44c5.67 0 10.423-1.882 13.895-5.097l-6.785-5.146c-1.882 1.265-4.289 2.018-7.11 2.018-5.47 0-10.11-3.693-11.766-8.658H5.24v5.307A20.98 20.98 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.234 27.117a12.58 12.58 0 0 1 0-8.234v-5.307H5.24a20.99 20.99 0 0 0 0 18.848l6.994-5.307Z" />
      <path fill="#EA4335" d="M24 8.225c3.09 0 5.862 1.063 8.045 3.15l6.036-6.036C34.414 1.995 29.663 0 24 0A20.98 20.98 0 0 0 5.24 13.576l6.994 5.307C13.89 11.918 18.53 8.225 24 8.225Z" />
    </svg><span>Continue with Google</span>
  </a>;
}
