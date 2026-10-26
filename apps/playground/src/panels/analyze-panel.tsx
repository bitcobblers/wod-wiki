/**
 * AnalyzePanel - Multi-select analysis entry point.
 *
 * Lists the selected entries and deep-links into the Metric Explorer with a
 * pre-filled WQL query comparing them (`sum:totalVolume{note:a|b} by {note}`).
 * Comparative visualization lives in the Explorer, not here (issue #729).
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { analyticsExplorerPath } from '@/lib/routes';
import type { HistoryRecord } from '@/types/history';

export interface AnalyzePanelProps {
  /** Selected entries for comparative analysis */
  selectedEntries: HistoryRecord[];
}

/** The pre-filled comparison query: per-note volume, OR-ed across the selection. */
export function buildComparisonQuery(entries: HistoryRecord[]): string {
  const notes = entries.map(e => e.id).join('|');
  return `sum:totalVolume{note:${notes}} by {note}`;
}

export const AnalyzePanel: React.FC<AnalyzePanelProps> = ({
  selectedEntries,
}) => {
  const { isCompact: mobile } = usePanelSize();
  const navigate = useNavigate();

  const explorerUrl = useMemo(
    () => analyticsExplorerPath({ q: buildComparisonQuery(selectedEntries) }),
    [selectedEntries],
  );

  return (
    <div className={cn("h-full bg-background flex flex-col", !mobile && "border-l border-border")}>
      <div className={cn("flex-1 flex flex-col gap-6", mobile ? "p-4" : "p-6")}>
        {/* Header */}
        <div className="flex items-center gap-3 text-foreground flex-shrink-0">
          <BarChart3 className="h-6 w-6" />
          <h2 className="text-xl font-semibold">
            Analyze
          </h2>
          <span className="text-sm text-muted-foreground ml-auto">(Comparative View)</span>
        </div>

        {/* Content Card - Centered vertically (middle aligned) */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="rounded-lg border border-border p-4 space-y-3 bg-card w-full max-w-md mx-auto">
            <div className="text-sm font-medium text-foreground">
              Selected Entries: {selectedEntries.length}
            </div>

            {selectedEntries.length > 0 ? (
              <ul className="space-y-2">
                {selectedEntries.map(entry => (
                  <li key={entry.id} className="flex items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground">•</span>
                    <span className="text-foreground">{entry.title}</span>
                    <span className="text-muted-foreground text-xs">
                      — {new Date(entry.updatedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground">
                No entries selected
              </div>
            )}

            {selectedEntries.length > 0 && (
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => navigate(explorerUrl)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Compare in Explorer
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
