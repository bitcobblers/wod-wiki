import { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { OutputStatement } from '@bitcobblers/wod-wiki-core';
import { TimeSpan } from '../../models/TimeSpan';

/**
 * Structured data carried by system output metrics.
 */
interface SystemOutputValue {
  /** The lifecycle event that triggered this output */
  event: 'push' | 'pop' | 'next' | 'event-action';
  /** The block key involved */
  blockKey: string;
  /** Human-readable block label (if available) */
  blockLabel?: string;
  /** Additional event-specific data */
  [key: string]: unknown;
}

/**
 * Action that emits a system-level output statement for lifecycle tracing.
 *
 * System outputs are diagnostic records emitted on block push/pop/next
 * and when event handlers produce actions. They flow through the normal
 * output pipeline (runtime.addOutput) and appear alongside segment/completion
 * outputs in the output log.
 *
 * Consumers that don't want system output can filter:
 *   outputs.filter(o => o.outputType !== 'system')
 *
 * ## Fragment Encoding
 *
 * Each system output carries a single metrics:
 * - metricType: MetricType.System
 * - type: 'lifecycle' | 'event-action'
 * - image: human-readable message
 * - value: SystemOutputValue with structured data
 * - origin: 'runtime'
 */
export class EmitSystemOutputAction implements IRuntimeAction {
  readonly type = 'emit-system-output';

  /**
   * @param message Human-readable description (becomes metrics.image)
   * @param event   Which lifecycle event triggered this output
   * @param blockKey The block key involved
   * @param blockLabel Optional human-readable block label
   * @param stackLevel Stack depth at time of emission
   * @param extra Additional key-value data to include in the metrics value
   */
  constructor(
    private readonly message: string,
    private readonly event: 'push' | 'pop' | 'next' | 'event-action',
    private readonly blockKey: string,
    private readonly blockLabel?: string,
    private readonly stackLevel?: number,
    private readonly extra?: Record<string, unknown>
  ) {}

  do(runtime: IRuntimeContext): IRuntimeAction[] {
    const now = runtime.clock.currentDate;

    const value: SystemOutputValue = {
      event: this.event,
      blockKey: this.blockKey,
      blockLabel: this.blockLabel,
      ...this.extra
    };

    const metric: IMetric = {
      type: MetricType.System,
      image: this.message,
      value,
      origin: 'runtime',
      timestamp: now,
    };

    const output = new OutputStatement({
      outputType: 'system',
      timeSpan: new TimeSpan(now.getTime(), now.getTime()),
      sourceBlockKey: this.blockKey,
      stackLevel: this.stackLevel ?? runtime.stack.count,
      metrics: [metric],
    });

    runtime.addOutput(output);
    return [];
  }
}
