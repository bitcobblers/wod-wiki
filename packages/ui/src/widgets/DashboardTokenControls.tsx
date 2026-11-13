import { useEffect, useState } from 'react';
import type { DashboardToken } from '@bitcobblers/wod-wiki-wql';
import { cn } from '../utils/cn';

export interface DashboardTokenControlsProps {
  tokens: DashboardToken[];
  /** Current value per token name (defaults applied by the caller). */
  values: Record<string, string>;
  /**
   * Present when the note is editable — a change commits exactly once, on an
   * explicit action: a list-token segment click, or a scalar-token blur /
   * Enter. Keystrokes only edit the local draft — they never rewrite the
   * note or re-run widgets mid-edit.
   */
  onChange?: (name: string, value: string) => void;
}

/**
 * Scalar token input — owns a local draft so typing stays in-process; the
 * committed value (blur or Enter) is the only write. External value changes
 * (e.g. a written note re-resolved) re-sync the draft.
 */
function ScalarTokenInput({
  name,
  value,
  disabled,
  onCommit,
}: {
  name: string;
  value: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
      }}
      aria-label={`Token ${name}`}
      className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary disabled:opacity-60"
    />
  );
}

/**
 * DashboardTokenControls — the control row a dashboard note's frontmatter
 * tokens render as (#899): scalar tokens become inputs, list tokens segmented
 * controls (first entry = default). Read-only views (no onChange) render the
 * current values as static text.
 */
export function DashboardTokenControls({ tokens, values, onChange }: DashboardTokenControlsProps) {
  if (tokens.length === 0) return null;
  const readOnly = !onChange;

  return (
    <div
      data-testid="dashboard-token-controls"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4"
    >
      {tokens.map((token) => {
        const current = values[token.name] ?? token.values[0];
        return (
          <div key={token.name} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">${token.name}</span>
            {token.isList ? (
              <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                {token.values.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      // A segment click IS the explicit commit — no draft.
                      if (option !== current) onChange?.(token.name, option);
                    }}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-md transition-colors',
                      option === current
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                      readOnly && 'cursor-default',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : readOnly ? (
              <span className="text-xs text-foreground font-mono">{current}</span>
            ) : (
              <ScalarTokenInput
                name={token.name}
                value={current}
                onCommit={(next) => onChange?.(token.name, next)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
