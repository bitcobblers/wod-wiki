"use client";

import type { DashboardToken } from '@bitcobblers/wod-wiki-wql';
import { Input } from '@ui-sdk/react/input';
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from '@ui-sdk/react/segmented-control';
import { useEffect, useState } from 'react';
import { cn } from '../utils/cn';

export interface DashboardTokenControlsProps {
  tokens: DashboardToken[];
  values: Record<string, string>;
  onChange?: (name: string, value: string) => void;
}

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
    <Input
      type="text"
      value={draft}
      disabled={disabled}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari/WebKit IME composition still emits keyCode 229 after compositionend
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
      }}
      aria-label={`Token ${name}`}
      className="w-20 h-auto rounded-lg border border-border bg-card px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary disabled:opacity-60"
    />
  );
}

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
              <SegmentedControl
                aria-label={`Token ${token.name}`}
                value={current}
                disabled={readOnly}
                onValueChange={(next) => {
                  if (next && next !== current) onChange?.(token.name, next);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
              >
                <SegmentedControlIndicator />
                {token.values.map((option) => (
                  <SegmentedControlItem
                    key={option}
                    value={option}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-md transition-colors text-muted-foreground hover:text-foreground data-checked:bg-primary data-checked:text-primary-foreground data-checked:font-medium',
                      readOnly && 'cursor-default',
                    )}
                  >
                    {option}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
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
