import { IAnalyticsEngine } from './contracts/IAnalyticsEngine';
import type { IRealtimeProcessor } from './IRealtimeProcessor';
import type { ISummaryProcessor } from './ISummaryProcessor';
import { IOutputStatement, OutputStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { ProjectionResult } from './ProjectionResult';
import { wallClockNow, type INowProvider } from '../runtime/INowProvider';

export class AnalyticsEngine implements IAnalyticsEngine {
  private realtimeProcessors: IRealtimeProcessor[] = [];
  private summaryProcessors: ISummaryProcessor[] = [];
  private outputHistory: IOutputStatement[] = [];
  /** Emits a live 'analytics' snapshot per segment so the UI updates in real time. */
  private _onLiveOutput?: (outputs: IOutputStatement[]) => void;
  private _liveProjections: ProjectionResult[] = [];
  /**
   * Signature of the last live projection emission. Used by finalize() to avoid
   * re-emitting the same projections at session end. Timestamps are ignored.
   */
  private _lastLiveProjectionSignature?: string;
  private _now: INowProvider;

  constructor(now: INowProvider = wallClockNow) {
    this._now = now;
  }

  setNowProvider(now: INowProvider): void {
    this._now = now;
  }

  getLiveProjections(): readonly ProjectionResult[] {
    return [...this._liveProjections];
  }
  /**
   * Wire a sink for live analytics outputs. The sink receives the FULL
   * projection snapshot (a replaceable, ephemeral set) each time projections
   * change — not appended one-at-a-time. The snapshot is display-only; it must
   * not be persisted. Persistence happens once via {@link finalize}.
   */
  setLiveOutputEmitter(emit: (outputs: IOutputStatement[]) => void): void {
    this._onLiveOutput = emit;
  }

  addRealtimeProcessor(processor: IRealtimeProcessor): void {
    this.realtimeProcessors.push(processor);
  }

  addSummaryProcessor(processor: ISummaryProcessor): void {
    this.summaryProcessors.push(processor);
  }

  run(output: IOutputStatement): IOutputStatement {
    // Phase 1: realtime enrichment — per-segment metric derivation
    let current = output;
    for (const processor of this.realtimeProcessors) {
      try {
        current = processor.process(current);
      } catch (err) {
        console.error(`[AnalyticsEngine] realtime error in '${processor.id}':`, err);
      }
    }

    // Accumulate segment outputs for summary processors, and emit a live
    // 'analytics' output so session-totals reach the UI over the output stream
    // (no separate tracker channel). Bounded recursion: the emitted 'analytics'
    // output is not a 'segment', so re-entering run() does not re-trigger this.
    if (current.outputType === 'segment') {
      this.outputHistory.push(current);
      if (this._onLiveOutput) {
        const projections = this._runSummaries();
        this._liveProjections = projections;
        const now = this._now.nowMs();
        const signature = this._projectionSignature(projections);
        if (signature !== this._lastLiveProjectionSignature) {
          this._lastLiveProjectionSignature = signature;
          const liveOutputs = this._buildProjectionOutputs(projections, now);
          this._onLiveOutput(liveOutputs);
        }
      }
    }

    return current;
  }

  finalize(): IOutputStatement[] {
    const projections = this._runSummaries();
    this._liveProjections = [];
    const outputs = this._buildProjectionOutputs(projections, this._now.nowMs());
    const signature = this._projectionSignature(projections);
    if (this._lastLiveProjectionSignature !== undefined && this._lastLiveProjectionSignature === signature) {
      return [];
    }
    return outputs;
  }

  /**
   * Identity of a projection set for dedupe — which fields make two emission
   * sets 'the same'. Timestamps are intentionally ignored; display/fact
   * layers have their own keys (see getAnalyticsFromLogs and
   * normalizeSummaryFacts).
   */
  private _projectionSignature(projections: ProjectionResult[]): string {
    return JSON.stringify(
      projections.map((p) => ({ name: p.name, value: p.value, unit: p.unit, metricType: p.metricType })),
    );
  }

  /** Build one 'analytics' OutputStatement per summary projection. */
  private _buildProjectionOutputs(projections: ProjectionResult[], now: number): IOutputStatement[] {
    return projections.map(p => {
      const metrics = MetricContainer.empty(`projection-${p.name}`).add(
        {
          type: MetricType.Label,
          image: p.name,
          value: p.name,
          origin: p.origin ?? 'analyzed',
          timestamp: new Date(now),
        },
        // Projection value metric — carries the processor's derivation
        // metadata (effortSlug/discipline/…) through to stored logs.
        {
          type: (p.metricType as MetricType) || MetricType.Metric,
          image: `${p.value} ${p.unit}`,
          value: p.value,
          unit: p.unit,
          origin: p.origin ?? 'analyzed',
          timestamp: new Date(now),
          ...(p.metadata ? { metadata: p.metadata } : {}),
        }
      );
      return new OutputStatement({
        outputType: 'analytics',
        timeSpan: { started: now, ended: now },
        sourceBlockKey: 'analytics-summary',
        stackLevel: 0,
        metrics,
      });
    });
  }

  /** Run all summary processors over current output history. */
  private _runSummaries(): ProjectionResult[] {
    const results: ProjectionResult[] = [];
    for (const processor of this.summaryProcessors) {
      try {
        results.push(...processor.summarize(this.outputHistory));
      } catch (err) {
        console.error(`[AnalyticsEngine] summary error in '${processor.id}':`, err);
      }
    }
    return results;
  }
}
