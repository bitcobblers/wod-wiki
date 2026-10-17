import type {
  IMetric,
  MetricOrigin,
  ReferenceDiagnostic,
  ReferenceMatchKind,
  ReferenceMetadata,
  ReferenceRef,
} from '@bitcobblers/wod-wiki-core';
import { MetricType, REFERENCE_METADATA_KEY } from '@bitcobblers/wod-wiki-core';

/**
 * Ordered deduplicated canonical equipment slugs for one statement — produced
 * by the shared reference resolver (`createReferenceIndex`) at parse/compile
 * time. The authored equipment text stays in `image`/`metadata.references.source`;
 * `value` is the canonical slug list downstream consumers (chips, indices,
 * output statements) read directly instead of re-parsing labels.
 */
export class EquipmentMetric implements IMetric {
  readonly type = MetricType.Equipment;
  readonly origin: MetricOrigin;
  /** Canonical slugs, ordered and deduplicated. */
  readonly value: string[];
  readonly image: string;
  readonly name = 'equipment';
  readonly metadata: Record<string, unknown>;

  constructor(
    slugs: readonly string[],
    options?: {
      refs?: ReferenceRef[];
      source?: string;
      matched?: ReferenceMatchKind;
      diagnostics?: ReferenceDiagnostic[];
      origin?: MetricOrigin;
    },
  ) {
    this.value = [...new Set(slugs)];
    this.image = options?.source ?? this.value.join(' ');
    this.origin = options?.origin ?? 'parser';
    const reference: ReferenceMetadata = {
      matched: options?.matched ?? 'whole',
      source: options?.source ?? this.image,
      ...(options?.refs ? { refs: options.refs } : {}),
      ...(options?.diagnostics?.length ? { diagnostics: options.diagnostics } : {}),
    };
    this.metadata = { [REFERENCE_METADATA_KEY]: reference };
  }
}
