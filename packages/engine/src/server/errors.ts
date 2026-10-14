/**
 * errors.ts — the single HTTP error type every layer throws; app.ts maps it
 * to the wire's { error, code? } JSON with the matching status.
 */
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}
