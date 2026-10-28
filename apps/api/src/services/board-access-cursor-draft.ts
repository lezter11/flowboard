/**
 * Unmounted cursor experiment. Callers MUST authenticate and authorize each
 * request and compare the returned revision with current database state.
 * A cursor is not an authorization grant. Runtime secret provisioning, key
 * rotation and the production cursor contract are intentionally not wired.
 */
export interface BoardAccessCursor {
  v: 1;
  boardId: string;
  actorId: string;
  revision: string;
  lastUserId: string;
}

const encoder = new TextEncoder();
const maxRevision = 9223372036854775807n;
const invalid = () => new Error('Invalid board access cursor.');

function validateSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
    throw new Error('Board access cursor signing requires a secret of at least 32 bytes.');
  }
}

function validateId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalPayload(value: unknown): BoardAccessCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== 5 || obj['v'] !== 1 || !validateId(obj['boardId']) || !validateId(obj['actorId']) || !validateId(obj['lastUserId']) ||
      typeof obj['revision'] !== 'string' || !/^[1-9][0-9]{0,18}$/.test(obj['revision']) || BigInt(obj['revision']) > maxRevision) throw invalid();
  return { v: 1, boardId: obj['boardId'], actorId: obj['actorId'], revision: obj['revision'], lastUserId: obj['lastUserId'] };
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(text: string): Uint8Array {
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) throw invalid();
  try {
    const result = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    if (encode(result) !== text) throw invalid();
    return result;
  } catch { throw invalid(); }
}

async function importKey(secret: Uint8Array): Promise<CryptoKey> {
  validateSecret(secret);
  // Copy to an ArrayBuffer-backed value for Node and Worker compatibility.
  return crypto.subtle.importKey('raw', Uint8Array.from(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}

export async function signBoardAccessCursor(payload: BoardAccessCursor, secret: Uint8Array): Promise<string> {
  const key = await importKey(secret);
  const canonical = canonicalPayload(payload);
  const body = encode(encoder.encode(JSON.stringify(canonical)));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}

export async function verifyBoardAccessCursor(token: string, secret: Uint8Array, scope: {boardId: string; actorId: string}): Promise<BoardAccessCursor> {
  const key = await importKey(secret);
  if (typeof token !== 'string' || token.length > 4096) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2) throw invalid();
  const [body, signature] = parts;
  if (!body || !signature) throw invalid();
  const bodyBytes = decode(body);
  const signatureBytes = decode(signature);
  if (signatureBytes.length !== 32 || !(await crypto.subtle.verify('HMAC', key, Uint8Array.from(signatureBytes), encoder.encode(body)))) throw invalid();
  try {
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bodyBytes));
    const payload = canonicalPayload(decoded);
    if (encode(encoder.encode(JSON.stringify(payload))) !== body || payload.boardId !== scope.boardId || payload.actorId !== scope.actorId) throw invalid();
    return payload;
  } catch { throw invalid(); }
}
