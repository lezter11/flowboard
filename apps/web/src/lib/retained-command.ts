/** One explicit operation, including its original input, until the server gives a definite answer. */
export function createRetainedCommand<T>(newKey: () => string = () => crypto.randomUUID()) {
  let attempt: { input: T; key: string } | null = null;
  let inFlight: Promise<unknown> | null = null;
  let unknownOutcome = false;
  return {
    unresolved: () => attempt !== null,
    retry<R>(send: (original: T, key: string) => Promise<R>): Promise<R> {
      if (!attempt) return Promise.reject(new Error('No original request is pending.'));
      return this.run(attempt.input, send);
    },
    async run<R>(input: T, send: (original: T, key: string) => Promise<R>): Promise<R> {
      if (inFlight) return inFlight as Promise<R>;
      attempt ??= { input: structuredClone(input), key: newKey() };
      const original = attempt;
      const request = (async () => {
        try {
          const result = await Promise.resolve().then(() => send(structuredClone(original.input), original.key));
          attempt = null;
          unknownOutcome = false;
          return result;
        } catch (error) {
          const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
          // A gateway timeout or server/transport fault may follow commit. Never guess a new operation in that case.
          if (!unknownOutcome && status >= 400 && status < 500 && status !== 408) attempt = null;
          else unknownOutcome = true;
          throw error;
        } finally { inFlight = null; }
      })();
      inFlight = request;
      return request;
    },
  };
}
