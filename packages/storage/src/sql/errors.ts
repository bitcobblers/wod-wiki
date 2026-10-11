/**
 * StorageError — the single error type every shared SQL layer throws.
 * Replaces the API server's HTTP-specific error: `status` keeps the wire
 * mapping for the HTTP surface, `code` carries a stable machine identifier
 * (e.g. 'domain_projection_unavailable') for browser callers.
 */
export class StorageError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'StorageError';
  }
}
