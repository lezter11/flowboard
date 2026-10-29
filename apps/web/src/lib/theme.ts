export const THEME_KEY = 'flowboard-ui-theme';

/** The sign-in page opens dark (as the prototype's sign-in screen does); every other screen opens light. */
export const isSigninPath = (pathname: string): boolean => /^\/signin\/?$/.test(pathname);

/** A stored choice always wins, both ways; the OS colour scheme is ignored. */
export function resolveTheme(pathname: string, saved: string | null): 'light' | 'dark' {
  if (saved === 'dark' || saved === 'light') return saved;
  return isSigninPath(pathname) ? 'dark' : 'light';
}

/** Same rule as resolveTheme, as the pre-paint script in app/layout.tsx. Keep the two in step. */
export const THEME_BOOT_SCRIPT =
  "try{var s=localStorage.getItem('flowboard-ui-theme');document.documentElement.dataset.theme=(s==='dark'||s==='light')?s:(/^\\/signin\\/?$/.test(location.pathname)?'dark':'light')}catch(e){if(/^\\/signin\\/?$/.test(location.pathname))document.documentElement.dataset.theme='dark'}";
