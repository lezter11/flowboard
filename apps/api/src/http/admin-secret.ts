import crypto from 'node:crypto';

const TEST_ONLY_SECRET = 'flowboard-dev-secret';
const MIN_SECRET_LENGTH = 32;

// The administrative secret has no built-in default outside tests: an unset or short secret
// means the protected route is simply closed, not guarded by a value anyone can read in the repo.
export function configuredAdminSecret(workerSecret?: string): string | null {
  const configured = workerSecret || (typeof process !== 'undefined' ? process.env?.['DEV_LOGIN_SECRET'] : undefined);
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'test') return configured || TEST_ONLY_SECRET;
  return null;
}

export function adminSecretMatches(provided: string | undefined, workerSecret?: string): boolean {
  const expected = configuredAdminSecret(workerSecret);
  if (!expected || !provided) return false;
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}
