import { IMetric, MetricType, MetricOrigin } from '@bitcobblers/wod-wiki-core';
import { formatDuration } from "../../time/calculateElapsed";

/**
 * **Elapsed** (Runtime layer)
 *
 * The total running time of the block's Time spans — Σ(end − start) for each
 * segment. Paused gaps between spans are excluded.
 *
 * Created by the runtime when collecting output statements.
 *
 * ## Glossary (docs/architecture/time-terminology.md)
 * - **Duration** = the plan (set by parser)
 * - **Time / Spans** = raw clock recordings (source data)
 * - **Elapsed** = sum of span durations, active time only — this metrics
 * - **Total** = lastEnd − firstStart (wall-clock bracket, includes pauses)
 *
 * @example
 * // Two spans: [0-100ms], [200-350ms] → Elapsed = 250ms
 * // (the 100ms paused gap between spans is excluded)
 */
export class ElapsedMetric implements IMetric {
  readonly type = MetricType.Elapsed;
  readonly origin: MetricOrigin = 'analyzed';
  readonly unit = 'ms';

  /**
   * @param value Elapsed time in milliseconds
   * @param sourceBlockKey Block that produced this measurement
   * @param timestamp When this metrics was created
   */
  constructor(
    readonly value: number,
    readonly sourceBlockKey?: string,
    readonly timestamp?: Date,
  ) {}

  /** Human-readable elapsed time (e.g., "5:03") */
  get image(): string {
    return formatDuration(this.value);
  }
}
