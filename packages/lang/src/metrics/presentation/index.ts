export type {
  MetricPresentationSurface,
  MetricRenderKind,
  MetricTone,
  MetricPresentationToken,
  IMetricPresentationPolicy,
} from './types';

export { metricPresentation, createMetricPresentationPolicy } from './MetricPresentationPolicy';
export {
  isTimeLikeMetric,
  computeLabel,
  computeColumnLabel,
  buildTooltip,
  dedupePresentedLabels,
} from './labelFormatting';
