import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import type { IMetric } from '@bitcobblers/wod-wiki-core';
import { RoundState, TimerState } from '../memory/MemoryTypes';
import { TimeSpan } from '../models/TimeSpan';
import { readTimer } from '../time/TimerSpans';
import { calculateElapsed } from '../time/calculateElapsed';
import { CurrentRoundMetric } from '../compiler/metrics/CurrentRoundMetric';
import { ElapsedMetric } from '../compiler/metrics/ElapsedMetric';
import { TotalMetric } from '../compiler/metrics/TotalMetric';
import { SpansMetric } from '../compiler/metrics/SpansMetric';
import { SystemTimeMetric } from '../compiler/metrics/SystemTimeMetric';
import { INowProvider, wallClockNow } from '../INowProvider';

export interface ReportOutputConfig {
    label?: string;
    emitSegmentOnMount?: boolean;
    emitMilestones?: boolean;
    computeTimeResults?: boolean;
}

export class ReportOutputBehavior implements IRuntimeBehavior {
    private lastEmittedRound?: number;

    constructor(
        private readonly config: ReportOutputConfig = {},
        private readonly _now: INowProvider = wallClockNow,
    ) { }

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        const shouldEmitSegment = this.config.emitSegmentOnMount ?? false;
        if (shouldEmitSegment) {
            const displayFragments = this.collectDisplayFragments(ctx);
            const stateFragments = this.collectStateFragments(ctx);
            const mergedFragments = this.mergeFragments(displayFragments, stateFragments);

            ctx.emitOutput('segment', mergedFragments.toArray(), {
                label: this.formatLabel(ctx),
            });
        }

        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
        const shouldEmitMilestones = this.config.emitMilestones ?? !!round;
        if (shouldEmitMilestones && round && (round.total === undefined || round.total > 1)) {
            this.lastEmittedRound = round.current;
            ctx.emitOutput('milestone', this.buildMilestoneFragments(ctx, round).toArray(), {
                label: this.formatRoundLabel(round),
            });
        }

        return [];
    }

    onNext(ctx: IBehaviorContext): IRuntimeAction[] {
        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
        const shouldEmitMilestones = this.config.emitMilestones ?? !!round;
        if (!shouldEmitMilestones || !round || (round.total !== undefined && round.total <= 1)) {
            return [];
        }

        if (round.total !== undefined && round.current > round.total) {
            return [];
        }

        // Only emit milestone when the round has actually changed.
        // ChildSelectionBehavior advances the round and dispatches new
        // children in the same onNext cycle, so children:status.allCompleted
        // is always false at this point. Tracking the last emitted round
        // avoids duplicate milestones without depending on child status.
        if (this.lastEmittedRound !== undefined && round.current === this.lastEmittedRound) {
            return [];
        }

        this.lastEmittedRound = round.current;
        ctx.emitOutput('milestone', this.buildMilestoneFragments(ctx, round).toArray(), {
            label: this.formatRoundLabel(round),
        });

        return [];
    }

    onUnmount(ctx: IBehaviorContext): IRuntimeAction[] {
        const timer = readTimer(ctx);
        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
        const shouldComputeTimeResults = this.config.computeTimeResults ?? true;

        // Determine completed rounds honestly on early abort/expiry (WW-105)
        const reason = ctx.block.completionReason;
        const earlyTermination = reason === 'user-abort' || reason === 'forced-pop' || reason === 'timer-expired';
        const effectiveRound = round
            ? earlyTermination
                ? { current: Math.max(0, round.current - 1), total: round.total }
                : round
            : undefined;

        // Determine a descriptive completion label
        let completionLabel = this.config.label ?? 'Completed';
        if (!this.config.label) {
            if (ctx.block.blockType === 'SessionRoot') {
                completionLabel = 'Session Completed';
            } else if (effectiveRound && !earlyTermination && effectiveRound.total !== undefined && effectiveRound.total > 1) {
                completionLabel = `Completed ${effectiveRound.total} Round(s)`;
            } else if (effectiveRound && effectiveRound.current > 0) {
                completionLabel = `Completed ${effectiveRound.current} Round(s)`;
            } else if (earlyTermination && round) {
                completionLabel = 'Completed 0 Round(s)';
            }
        }

        if (shouldComputeTimeResults) {
            const displayGroups = ctx.block.getMemoryByTag('metric:display');
            if (displayGroups.length > 1) {
                // Split results proportionally across groups
                const resultGroups = this.computeSplitTimeResults(
                    ctx,
                    timer,
                    displayGroups.map(loc => loc.metrics),
                    completionLabel
                );
                this.writeResultGroups(ctx, resultGroups);
                return [];
            }
        }

        const resultFragments = shouldComputeTimeResults
            ? this.computeTimeResults(ctx, timer, completionLabel)
            : MetricContainer.from(
                [new SystemTimeMetric(this._now.now(), ctx.block.key.toString())],
                ctx.block.key.toString()
            );

        this.writeResultMemory(ctx, resultFragments);

        return [];
    }

    onDispose(_ctx: IBehaviorContext): void {
        // No cleanup needed
    }

    private collectDisplayFragments(ctx: IBehaviorContext): MetricContainer {
        const metrics = MetricContainer.empty(ctx.block.key.toString());
        for (const loc of ctx.block.getMemoryByTag('metric:display')) {
            metrics.merge(loc.metrics);
        }
        return metrics;
    }

    private collectStateFragments(ctx: IBehaviorContext): MetricContainer {
        const metrics = MetricContainer.empty(ctx.block.key.toString());
        for (const loc of ctx.block.getMemoryByTag('round')) metrics.merge(loc.metrics);
        for (const loc of ctx.block.getMemoryByTag('time')) metrics.merge(loc.metrics);
        return metrics;
    }

    private mergeFragments(displayFragments: MetricContainer, stateFragments: MetricContainer): MetricContainer {
        const displayTypes = new Set(displayFragments.map(f => `${f.type}:${f.type}`));
        const uniqueStateFragments = stateFragments.filter(
            f => !displayTypes.has(`${f.type}:${f.type}`)
        );
        return displayFragments.clone().add(...uniqueStateFragments);
    }

    private buildMilestoneFragments(ctx: IBehaviorContext, round: RoundState): MetricContainer {
        const metrics = MetricContainer.empty(ctx.block.key.toString()).add(
            new CurrentRoundMetric(
                round.current,
                round.total,
                ctx.block.key.toString(),
                ctx.clock.currentDate,
            ),
        );

        const timer = readTimer(ctx);
        if (timer) {
            const nowMs = ctx.clock.currentDate.getTime();
            const elapsed = calculateElapsed(timer, nowMs);
            metrics.add(new ElapsedMetric(elapsed, ctx.block.key.toString(), ctx.clock.currentDate));

            if (timer.spans.length > 0) {
                metrics.add(new SpansMetric([...timer.spans], ctx.block.key.toString(), ctx.clock.currentDate));
            }
        }

        return metrics;
    }

    private resolveFallbackTiming(
        ctx: IBehaviorContext,
        nowMs: number,
    ): { started: number; ended: number; elapsedMs: number } | null {
        if (ctx.block.blockType === 'WaitingToStart') return null;
        const timing = (ctx.block as { executionTiming?: { startTime?: Date } }).executionTiming;
        const execStartMs = timing?.startTime?.getTime();
        if (execStartMs === undefined || !Number.isFinite(execStartMs) || execStartMs > nowMs) {
            return null;
        }
        return {
            started: execStartMs,
            ended: nowMs,
            elapsedMs: Math.max(0, nowMs - execStartMs),
        };
    }

    private computeTimeResults(
        ctx: IBehaviorContext,
        timer: TimerState | undefined,
        customRoundLabel?: string
    ): MetricContainer {
        const now = ctx.clock.currentDate;
        const nowMs = now.getTime();
        const blockKey = ctx.block.key.toString();
        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;

        const reason = ctx.block.completionReason;
        const earlyTermination = reason === 'user-abort' || reason === 'forced-pop' || reason === 'timer-expired';
        const reportedRound = round && earlyTermination
            ? { current: Math.max(0, round.current - 1), total: round.total }
            : round;

        if (timer && timer.spans.length > 0) {
            const elapsed = calculateElapsed(timer, nowMs);
            const closedSpans = timer.spans.map((s) =>
                s.ended !== undefined ? s : new TimeSpan(s.started, nowMs),
            );
            const firstStart = closedSpans[0].started;
            const lastSpan = closedSpans[closedSpans.length - 1];
            const lastEnd = lastSpan.ended ?? nowMs;
            const total = Math.max(0, lastEnd - firstStart);

            const metrics = MetricContainer.empty(blockKey).add(
                new ElapsedMetric(elapsed, blockKey, now),
                new TotalMetric(total, blockKey, now),
                new SpansMetric(closedSpans, blockKey, now),
                new SystemTimeMetric(this._now.now(), blockKey),
            );
            if (reportedRound && reportedRound.current > 0) {
                metrics.add(new CurrentRoundMetric(reportedRound.current, reportedRound.total, blockKey, now, customRoundLabel));
            }
            return metrics;
        }

        const fallback = this.resolveFallbackTiming(ctx, nowMs);
        const span = fallback ? new TimeSpan(fallback.started, fallback.ended) : new TimeSpan(nowMs, nowMs);
        const fallbackElapsed = fallback?.elapsedMs ?? 0;
        const metrics = MetricContainer.empty(blockKey).add(
            new ElapsedMetric(fallbackElapsed, blockKey, now),
            new TotalMetric(fallbackElapsed, blockKey, now),
            new SpansMetric([span], blockKey, now),
            new SystemTimeMetric(this._now.now(), blockKey),
        );
        if (reportedRound && reportedRound.current > 0) {
            metrics.add(new CurrentRoundMetric(reportedRound.current, reportedRound.total, blockKey, now, customRoundLabel));
        }
        return metrics;
    }

    private buildWeightedSplitGroups(
        firstStart: number,
        totalElapsed: number,
        totalDuration: number,
        now: Date,
        blockKey: string,
        round: RoundState | undefined,
        groups: MetricContainer[],
        customRoundLabel?: string,
    ): MetricContainer[] {
        const weights = groups.map(group => {
            const reps = group
                .filter(f => f.type === MetricType.Rep && typeof f.value === 'number')
                .reduce((sum, f) => sum + (f.value as number), 0);
            return reps > 0 ? reps : 1;
        });
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);

        let currentOffsetMs = 0;
        return groups.map((group, i) => {
            const weight = weights[i];
            const ratio = weight / totalWeight;
            const groupElapsed = Math.round(totalElapsed * ratio);
            const groupTotal = Math.round(totalDuration * ratio);

            const groupStart = firstStart + currentOffsetMs;
            const groupEnd = groupStart + groupTotal;
            currentOffsetMs += groupTotal;

            const groupFragments = group.clone().add(
                new ElapsedMetric(groupElapsed, blockKey, now),
                new TotalMetric(groupTotal, blockKey, now),
                new SpansMetric([new TimeSpan(groupStart, groupEnd)], blockKey, now),
                new SystemTimeMetric(this._now.now(), blockKey),
            );
            if (round) {
                groupFragments.add(new CurrentRoundMetric(round.current, round.total, blockKey, now, customRoundLabel));
            }
            return groupFragments;
        });
    }

    private computeSplitTimeResults(
        ctx: IBehaviorContext,
        timer: TimerState | undefined,
        groups: MetricContainer[],
        customRoundLabel?: string
    ): MetricContainer[] {
        const now = ctx.clock.currentDate;
        const nowMs = now.getTime();
        const blockKey = ctx.block.key.toString();
        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;

        if (!timer || timer.spans.length === 0) {
            const fallback = this.resolveFallbackTiming(ctx, nowMs);
            if (fallback) {
                return this.buildWeightedSplitGroups(
                    fallback.started,
                    fallback.elapsedMs,
                    fallback.elapsedMs,
                    now,
                    blockKey,
                    round,
                    groups,
                    customRoundLabel,
                );
            }
            return groups.map((group) => {
                const groupFragments = group.clone().add(
                    new ElapsedMetric(0, blockKey, now),
                    new TotalMetric(0, blockKey, now),
                    new SpansMetric([new TimeSpan(nowMs, nowMs)], blockKey, now),
                    new SystemTimeMetric(this._now.now(), blockKey),
                );
                if (round) {
                    groupFragments.add(new CurrentRoundMetric(round.current, round.total, blockKey, now, customRoundLabel));
                }
                return groupFragments;
            });
        }

        const totalElapsed = calculateElapsed(timer, nowMs);
        const firstStart = timer.spans[0].started;
        const lastEnd = timer.spans[timer.spans.length - 1].ended ?? nowMs;
        const totalDuration = lastEnd - firstStart;

        return this.buildWeightedSplitGroups(
            firstStart,
            totalElapsed,
            totalDuration,
            now,
            blockKey,
            round,
            groups,
            customRoundLabel,
        );
    }

    private writeResultMemory(ctx: IBehaviorContext, resultFragments: MetricContainer): void {
        const existing = ctx.block.getMemoryByTag('metric:result');
        if (existing.length > 0) {
            // User-origin actuals (e.g. clock-committed rep counts) were merged
            // into result memory before pop — computed results replace runtime
            // state only and must not clobber them (ownership resolution keeps
            // the user-entry winner downstream).
            const preserved = collectUserOriginMetrics(existing);
            if (preserved.length > 0) {
                resultFragments = resultFragments.clone().add(...preserved);
            }
            ctx.updateMemory('metric:result', resultFragments.toArray());
            return;
        }

        ctx.pushMemory('metric:result', resultFragments.toArray());
    }

    private writeResultGroups(ctx: IBehaviorContext, resultGroups: MetricContainer[]): void {
        const existing = ctx.block.getMemoryByTag('metric:result');
        if (existing.length === 0) {
            for (const group of resultGroups) {
                ctx.pushMemory('metric:result', group.toArray());
            }
            return;
        }

        // Pre-committed user-origin actuals live in per-group result
        // locations (one per display group — see actuals.ts). Merge them into
        // the matching computed group by index; both derive from the same
        // display-group structure.
        const count = Math.max(existing.length, resultGroups.length);
        for (let i = 0; i < count; i++) {
            const base = resultGroups[i] ? resultGroups[i].clone() : existing[i].metrics.clone();
            // base already carries the user metrics when it IS the existing container
            const userMetrics = resultGroups[i] && i < existing.length ? collectUserOriginMetrics([existing[i]]) : [];
            const merged = base.add(...userMetrics);
            if (i < existing.length) {
                existing[i].update(merged);
            } else {
                ctx.pushMemory('metric:result', merged.toArray());
            }
        }
    }

    private formatLabel(ctx: IBehaviorContext): string {
        return this.config.label ?? ctx.block.label;
    }

    private formatRoundLabel(round: RoundState): string {
        return round.total !== undefined
            ? `Round ${round.current} of ${round.total}`
            : `Round ${round.current}`;
    }
}

/** User-origin metrics across result locations — the actuals that survive pop. */
function collectUserOriginMetrics(locations: { metrics: MetricContainer }[]): IMetric[] {
    const userMetrics: IMetric[] = [];
    for (const loc of locations) {
        for (const m of loc.metrics) {
            if (m.origin === 'user') userMetrics.push(m);
        }
    }
    return userMetrics;
}
