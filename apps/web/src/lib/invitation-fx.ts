/** Pure helpers for the invitation screens (no DOM), so copy, the greeting and the easter-egg trigger can be unit tested. */

export const GREETINGS: readonly string[] = [
  'Good to see you.',
  'Pull up a chair.',
  'Your seat at the board is ready.',
  'Nice to have you here.',
  'Glad you made it.',
];

/** Picks a greeting from a 0..1 random value, clamped so a bad value cannot index outside the list. */
export function pickGreeting(random: number): string {
  const i = Math.floor((Number.isFinite(random) ? random : 0) * GREETINGS.length);
  return GREETINGS[Math.min(GREETINGS.length - 1, Math.max(0, i))];
}

/** Motion, confetti and every easter egg are off when the person asks for reduced motion. */
export const motionAllowed = (prefersReduced: boolean): boolean => !prefersReduced;

/** Counts quick repeated taps: true on the Nth tap within the window, then starts over. */
export function createTapCounter(options: { taps?: number; windowMs?: number; now?: () => number } = {}) {
  const taps = options.taps ?? 5;
  const windowMs = options.windowMs ?? 2000;
  const now = options.now ?? (() => Date.now());
  let times: number[] = [];
  return {
    tap(): boolean {
      const t = now();
      times = times.filter((x) => t - x <= windowMs);
      times.push(t);
      if (times.length >= taps) { times = []; return true; }
      return false;
    },
  };
}

/** The line shown on the wrong-account screen. It is the viewer's own address, never the invited one. */
export function signedInAsLine(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed ? `Signed in as ${trimmed}` : null;
}

/** Where Google sign-in sends the person back to: the same invitation link, validated by the API as a same-app path. */
export function invitationSignInHref(token: string | null): string {
  return token ? `/api/v1/auth/google/start?next=${encodeURIComponent(`/invitation?token=${token}`)}` : '/signin';
}
