import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../http/errors.ts';

interface ImageWorkScope {
  active: boolean;
  pending: number;
  settled: () => void;
}
const storage = new AsyncLocalStorage<ImageWorkScope>();
// Worker constructs createApp for every request. This slot belongs to the isolate,
// not that app instance; there is no queue retaining another image request body.
let occupied: ImageWorkScope | undefined;

function finish(scope: ImageWorkScope): void {
  if (!scope.active && scope.pending === 0) {
    if (occupied === scope) occupied = undefined;
    scope.settled();
  }
}

export function imageAdmissionUnavailable(): HttpError {
  return HttpError.serviceUnavailable('Image processing is busy or unavailable. Try again shortly.');
}
export function assertImageWorkActive(): void {
  const scope = storage.getStore();
  if (scope && !scope.active) throw imageAdmissionUnavailable();
}
function hold(scope: ImageWorkScope): () => void {
  scope.pending++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scope.pending--;
    finish(scope);
  };
}
/** Retain the real work lifetime, including a provider that ignores caller abort. */
export function retainImageWork(): () => void {
  const scope = storage.getStore();
  if (!scope) return () => {};
  assertImageWorkActive();
  return hold(scope);
}

export async function withImageAdmission<T>(
  signal: AbortSignal,
  run: (retainCleanup: () => () => void) => Promise<T>,
  onLifetime?: (work: Promise<void>) => void,
): Promise<T> {
  if (occupied || signal.aborted) throw imageAdmissionUnavailable();
  let settled!: () => void;
  const lifetime = new Promise<void>(resolve => { settled = resolve; });
  const scope: ImageWorkScope = { active: true, pending: 1, settled };
  occupied = scope;
  const abort = () => { scope.active = false; };
  signal.addEventListener('abort', abort, { once: true });
  try {
    onLifetime?.(lifetime);
    return await storage.run(scope, () => run(() => hold(scope)));
  } finally {
    scope.active = false;
    signal.removeEventListener('abort', abort);
    scope.pending--;
    finish(scope);
  }
}
