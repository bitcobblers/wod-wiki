import type { IEffortResolver } from '../effort-registry/types';
import type { ReferenceIndex } from '../effort-registry/reference-resolution';

/**
 * AnalyticsContext — shared services injected into the analytics pipeline.
 *
 * Provides processors with domain-level resolution capabilities without
 * direct coupling to registry implementations.
 *
 * @see docs/adr/effort-resolution-compile-time.md
 */
export interface AnalyticsContext {
  /** Effort resolver for canonical slug and fuzzy alias matching. */
  effortResolver: IEffortResolver;
  /** Shared reference index for canonical effort/equipment resolution. */
  references?: ReferenceIndex;
}
