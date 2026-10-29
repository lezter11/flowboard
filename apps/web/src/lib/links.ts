export const LINKS_MAX = 10;

/** Mirrors the API rule (isSafeHttpsUrl in the contracts package): https only, a host, no credentials, no spaces. The API stays the authority. */
export function isSafeHttpsUrl(value: string): boolean {
  if (value.length > 2000 || /\s/.test(value) || !/^https:\/\/[^/]/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}
