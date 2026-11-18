import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import { metricPresentation } from '@bitcobblers/wod-wiki-engine';
import type { MetricPresentationToken, MetricPresentationSurface } from '@bitcobblers/wod-wiki-engine';
import { getMetricColorClasses, getMetricIcon } from '@/views/runtime/metricColorMap';

export interface ThemedMetricPresentationToken extends MetricPresentationToken {
  /** Tailwind color classes for badge background, border, and text */
  readonly colorClasses: string;
  /** Emoji icon, or null if this metric type has no icon */
  readonly icon: string | null;
  /** Extra Tailwind classes for user-entered origin affordance */
  readonly originClasses: string;
}

function formatTooltipMetricValue(token: MetricPresentationToken): string {
  const { metric, label } = token;
  const val = metric.value;
  if (metric.type === 'duration' || metric.type === 'time' || metric.type === 'elapsed') {
    if (label && label !== String(val)) return label;
    if (typeof val === 'number' && Number.isFinite(val)) {
      const totalSec = Math.floor(Math.max(0, val) / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }
  if (val && typeof val === 'object') {
    const record = val as Record<string, unknown>;
    if ('amount' in record && 'units' in record && record.amount !== undefined && record.units !== undefined) {
      return `${record.amount} ${record.units}`;
    }
    if (label) return label;
  }
  return String(val ?? label ?? '');
}

function formatSafeTooltip(token: MetricPresentationToken): string {
  const formattedValue = formatTooltipMetricValue(token);
  if (!token.tooltip) {
    return `Type: ${token.metric.type}\nValue: ${formattedValue}`;
  }
  return token.tooltip.replace(/^Value: .*$/m, `Value: ${formattedValue}`);
}

/**
 * Decorate a framework-agnostic token with Tailwind color classes and icons.
 * Keeps React/Tailwind knowledge out of the core policy module.
 */
export function themeToken(token: MetricPresentationToken): ThemedMetricPresentationToken {
  const valueStr = token.metric.image ?? String(token.metric.value ?? '');
  return {
    ...token,
    tooltip: formatSafeTooltip(token),
    colorClasses: getMetricColorClasses(token.metric.type as string, valueStr),
    icon: getMetricIcon(token.metric.type as string, valueStr),
    originClasses: token.userEntered
      ? 'border-dashed italic ring-1 ring-offset-1 ring-primary/30'
      : '',
  };
}

/**
 * Present a group of metrics on the given surface, returning themed tokens
 * ready for React rendering.
 */
export function presentThemedGroup(
  metrics: readonly IMetric[],
  surface: MetricPresentationSurface,
): ThemedMetricPresentationToken[] {
  return metricPresentation.presentGroup(metrics, surface).map(themeToken);
}
