import type { IAnalyticsProfile, AnalyticsProfileContext } from './IAnalyticsProfile';
import type { IRealtimeProcessor } from './IRealtimeProcessor';
import type { ISummaryProcessor } from './ISummaryProcessor';
import type { IAnalyticsProcessorDescriptor } from './IAnalyticsProcessorDescriptor';
import { Registry } from '../registry/Registry';
import { TwoPassEffortResolutionProcess } from './TwoPassEffortResolutionProcess';
import { createCalcEngine } from './calc/factory';

/**
 * Consumer-facing registries for analytics processors — extension points
 * for custom (e.g. sport-specific) processors. The built-in calculations
 * are no longer processors: they are registered composed calcs evaluated
 * by the CalcEngine (#879 cutover). Register custom processors with the
 * standard `register`/`unregister` shape.
 *
 * @example
 * ```typescript
 * import { summaryProcessorRegistry } from 'wod-wiki/core';
 * summaryProcessorRegistry.register(ClimbGradeProgressionProcess);
 * ```
 */
export const realtimeProcessorRegistry = new Registry<IRealtimeProcessor>([]);

export const summaryProcessorRegistry = new Registry<ISummaryProcessor>([]);

/**
 * Standard built-in analytics profile.
 *
 * Chain: TwoPassEffortResolutionProcess (effort-data infrastructure) →
 * CalcEngine (the composed calculation layer: phase-1 segment annotations
 * as a realtime processor, phase-2 workout running totals as a summary
 * processor) → any custom registry processors. Applicability of individual
 * calcs is dynamic (`when` predicates, #848); the fence/requiredMetrics
 * filter below still applies to custom registry processors.
 */
export class StandardAnalyticsProfile implements IAnalyticsProfile {
    build(context: AnalyticsProfileContext): {
        realtime: IRealtimeProcessor[];
        summary: ISummaryProcessor[];
    } {
        const realtime: IRealtimeProcessor[] = [];
        const summary: ISummaryProcessor[] = [];

        // Two-pass effort resolution MUST run first so downstream processors
        // (and the calc engine's effort context node) see enriched
        // effort-data metrics. The calc engine needs the resolver for its
        // effort lookup table — without one, neither is registered.
        if (context.analyticsContext?.effortResolver) {
            realtime.push(new TwoPassEffortResolutionProcess(context.analyticsContext.effortResolver));
            const calcEngine = createCalcEngine(context.dialect, {
                effortResolver: context.analyticsContext.effortResolver,
                userProfile: context.userProfile,
                calcs: context.calcs,
                tags: context.tags,
                activeTags: context.activeTags,
                propertySources: context.propertySources,
            });
            realtime.push(calcEngine);
            summary.push(calcEngine);
        }

        realtime.push(...realtimeProcessorRegistry.list().filter(p => this.isApplicable(p, context)));
        summary.push(...summaryProcessorRegistry.list().filter(p => this.isApplicable(p, context)));

        return { realtime, summary };
    }

    private isApplicable(
        processor: IAnalyticsProcessorDescriptor,
        context: AnalyticsProfileContext
    ): boolean {
        // Fence-dialect filter: if `fenceTypes` is specified, context dialect must be in the list
        if (processor.fenceTypes && processor.fenceTypes.length > 0) {
            if (!processor.fenceTypes.includes(context.dialect)) {
                return false;
            }
        }

        // Required metrics filter: if requiredMetrics is specified, ALL must be present
        if (processor.requiredMetrics && processor.requiredMetrics.length > 0) {
            for (const required of processor.requiredMetrics) {
                if (!context.scriptMetricTypes.has(required)) {
                    return false;
                }
            }
        }

        return true;
    }
}
