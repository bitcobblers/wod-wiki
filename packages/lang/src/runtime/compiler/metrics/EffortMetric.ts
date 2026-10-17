import { IMetric, MetricType, MetricOrigin, REFERENCE_METADATA_KEY } from '@bitcobblers/wod-wiki-core';

export class EffortMetric implements IMetric {
  readonly value: string;
  readonly image: string;
  readonly origin: MetricOrigin = 'parser';
  readonly metadata?: Record<string, unknown>;

  constructor(
    /** Authored effort text — never rewritten; canonical identity lives in `value`. */
    public effort: string,
    options?: {
      /** Canonical resolved slug when the shared reference resolver matched. */
      resolvedSlug?: string;
      /** Structured reference resolution payload under the core metadata key. */
      references?: Record<string, unknown>;
    },
  ) {
    this.value = options?.resolvedSlug ?? effort;
    this.image = effort;
    if (options?.references) {
      this.metadata = { [REFERENCE_METADATA_KEY]: options.references };
    }
  }
  readonly type = MetricType.Effort;
}

