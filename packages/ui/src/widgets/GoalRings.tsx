import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { WqlEmptyState } from './WqlEmptyState';
import { formatMetricValue } from './chartFormat';

export interface GoalRingsProps {
  result: QueryResult | undefined;
  params?: string[];
  label?: string;
  unit?: string;
}

export function GoalRings({ result, attributes, params, label, unit }: GoalRingsProps & { attributes?: Record<string, string> }) {
  if (!result || result.series.length === 0) {
    return <WqlEmptyState result={result} />;
  }

  const rawTarget = attributes?.['goal'] ?? (params && params.length > 0 ? params[0] : undefined);
  const targetValue = rawTarget ? parseFloat(rawTarget) : undefined;
  const hasValidTarget = targetValue !== undefined && !isNaN(targetValue) && targetValue > 0;

  const displayUnit = unit ?? result.unit ?? result.parsed.displayUnit ?? '';

  return (
    <div
      className="flex flex-wrap items-center justify-around gap-4 h-full p-2"
      data-testid="goal-rings-widget"
    >
      {result.series.map((s, idx) => {
        const lastPoint = s.points.length > 0 ? s.points[s.points.length - 1] : undefined;
        const currentVal = lastPoint ? lastPoint.value : 0;
        const pct = hasValidTarget ? Math.round((currentVal / targetValue) * 100) : undefined;
        const itemLabel = s.label || label || (result.series.length === 1 ? 'Target' : `Series ${idx + 1}`);

        return (
          <GoalRingItem
            key={s.key || idx}
            label={itemLabel}
            current={currentVal}
            target={targetValue}
            pct={pct}
            unit={s.unit || displayUnit}
          />
        );
      })}
    </div>
  );
}

function GoalRingItem({
  label,
  current,
  target,
  pct,
  unit,
}: {
  label: string;
  current: number;
  target?: number;
  pct?: number;
  unit: string;
}) {
  const formattedCurrent = formatMetricValue(current);
  const formattedTarget = target !== undefined ? formatMetricValue(target) : undefined;

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = pct !== undefined ? Math.min(Math.max(pct, 0), 100) : 0;
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference;

  let strokeColor = 'stroke-primary';
  let textColor = 'text-foreground';
  if (pct !== undefined) {
    if (pct >= 100) {
      strokeColor = 'stroke-signal-positive';
      textColor = 'text-signal-positive';
    } else if (pct >= 75) {
      strokeColor = 'stroke-primary';
    } else if (pct >= 50) {
      strokeColor = 'stroke-signal-caution';
    } else {
      strokeColor = 'stroke-signal-negative';
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-w-28 text-center" data-testid="goal-ring-item">
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="stroke-muted"
            strokeWidth="8"
            fill="transparent"
          />
          {pct !== undefined && (
            <circle
              cx="50"
              cy="50"
              r={radius}
              className={`${strokeColor} transition-all duration-500 ease-out`}
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
            />
          )}
        </svg>

        <div className="absolute flex flex-col items-center justify-center">
          {pct !== undefined ? (
            <span className={`text-base font-bold tabular-nums leading-none ${textColor}`}>
              {pct}%
            </span>
          ) : (
            <span className="text-sm font-semibold tabular-nums leading-none text-foreground">
              {formattedCurrent}
            </span>
          )}
          {pct !== undefined && (
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {formattedCurrent} {unit}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-col items-center max-w-32">
        <span className="text-xs font-medium text-foreground truncate w-full" title={label}>
          {label}
        </span>
        {formattedTarget && (
          <span className="text-[10px] text-muted-foreground">
            Goal: {formattedTarget} {unit}
          </span>
        )}
      </div>
    </div>
  );
}
