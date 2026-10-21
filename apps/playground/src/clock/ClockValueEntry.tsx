import React, { useEffect, useRef, useState } from 'react';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import {
  type ClockEntry,
  applyEntryKey,
  parseClockDraftValue,
  normalizeClockKey,
} from '@/clock/clockCommands';
import { cn } from '@/lib/utils';

/**
 * ClockValueEntry — the shared accessible value-entry card for clock-driven
 * collection (browser keyboard, TV D-pad via getFocusProps, receiver).
 *
 * ONE draft pipeline: draft parsing/key transforms live in the commands
 * module (`parseClockDraftValue` / `applyEntryKey`) shared with the keyboard
 * buffer; the card renders the draft (controlled via `draft` when the shared
 * buffer owns it, local otherwise) and every edit notifies `onDraftChange`.
 * Drafts are preserved on validation/save errors — only a successful save
 * clears them. Save commits exactly once per press/Enter via a synchronous
 * busy gate, and the card's Enter never reaches the global keyboard bubble.
 */

export type EntryParseResult = { ok: true; value: number } | { ok: false; reason: string };

/** Validate a numeric value arriving through a command (trust boundary re-check). */
export function validateEntryValue(entry: Pick<ClockEntry, 'domain'>, value: number): EntryParseResult {
  if (!Number.isFinite(value)) return { ok: false, reason: 'Invalid number' };
  switch (entry.domain) {
    case 'integer':
      return Number.isSafeInteger(value) && value >= 0
        ? { ok: true, value }
        : { ok: false, reason: 'Whole number 0 or more required' };
    case 'choice':
      return Number.isInteger(value) && value >= 0
        ? { ok: true, value }
        : { ok: false, reason: 'Invalid choice' };
    case 'duration':
    case 'decimal':
      return value >= 0 ? { ok: true, value } : { ok: false, reason: 'Must be 0 or more' };
  }
}

/** Split the canonical 'M:SS' duration draft into editable parts (mid-typing digits are seconds). */
function durationParts(draft: string): { min: string; sec: string } {
  if (draft.includes(':')) {
    const m = /^(\d*):(\d*)$/.exec(draft);
    if (m) return { min: m[1] ?? '', sec: m[2] ?? '' };
  }
  return { min: '', sec: draft.replace(/\D/g, '') };
}

export interface ClockValueEntryProps {
  entry: ClockEntry;
  saving: boolean;
  error: string | null;
  onSave: (value: number) => void | Promise<unknown>;
  onCancel: () => void;
  onSkip?: () => void;
  /** Label for the skip affordance (defaults to 'Skip'). */
  skipLabel?: string;
  onChoice?: (index: number) => void;
  /** Notifies the parent (or keyboard-buffer owner) of draft edits. */
  onDraftChange?: (text: string) => void;
  /** Controlled draft from the shared keyboard buffer; uncontrolled when absent. */
  draft?: string;
  /** Seeds the uncontrolled draft when the card remounts on field navigation. */
  initialDraft?: string;
  /** D-pad focus wiring (receiver); spreads FocusProps onto every control. */
  getFocusProps?: (id: string) => FocusProps;
}

const fp = (wiring: ((id: string) => FocusProps) | undefined, id: string): Partial<FocusProps> =>
  wiring ? wiring(id) : {};

export const ClockValueEntry: React.FC<ClockValueEntryProps> = ({
  entry,
  saving,
  error,
  onSave,
  onCancel,
  onSkip,
  skipLabel,
  onChoice,
  onDraftChange,
  draft: draftProp,
  initialDraft,
  getFocusProps,
}) => {
  const [innerDraft, setInnerDraft] = useState(initialDraft ?? '');
  const draft = draftProp ?? innerDraft;
  const updateDraft = (text: string) => {
    setInnerDraft(text);
    onDraftChange?.(text);
  };

  const [localError, setLocalError] = useState<string | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(entry.selectedIndex ?? 0);
  const busyRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const alternatives = entry.alternatives ?? [];

  const shownError = error ?? localError;

  const commit = () => {
    if (busyRef.current || saving) return;
    const parsed = entry.domain === 'choice'
      ? validateEntryValue(entry, choiceIndex)
      : parseClockDraftValue(draft, entry.domain);
    if (parsed.ok === false) {
      setLocalError('error' in parsed ? parsed.error : parsed.reason); // draft preserved
      return;
    }
    setLocalError(null);
    busyRef.current = true;
    try {
      const result = onSave(parsed.value);
      if (result && typeof result.then === 'function') {
        result.then(
          () => { busyRef.current = false; },
          () => { busyRef.current = false; },
        );
      } else {
        busyRef.current = false;
      }
    } catch {
      busyRef.current = false;
    }
  };

  // Single owner of Enter: the card commits and the global bubble never sees
  // it. Held-down Enter (e.repeat) is ignored — one commit per press.
  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) commit();
    }
  };

  const pressKey = (key: string) => {
    setLocalError(null);
    updateDraft(applyEntryKey(entry.domain, draft, key));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.nativeEvent.isComposing) return;
    if (e.key === 'Tab') {
      const controls = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
      const first = controls[0];
      const last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
      e.stopPropagation();
      return;
    }
    const action = normalizeClockKey(e, { entryOpen: true });
    if (action.kind === 'none' || action.kind === 'direction' || action.kind === 'select') return;
    const textInput = e.target instanceof HTMLInputElement;
    if (textInput && ((action.kind === 'digit' && /^[\d.,]$/.test(e.key)) || e.key === 'Backspace')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && action.kind !== 'digit' && action.kind !== 'back') return;
    if (action.kind === 'primary') commit();
    else if (action.kind === 'cancel') onCancel();
    else if (action.kind === 'back') pressKey(e.key === 'Clear' ? 'clear' : 'back');
    else if (action.kind === 'digit') {
      if (entry.domain === 'choice') {
        const index = Number(action.digit) - 1;
        if (alternatives[index]) { setChoiceIndex(index); onChoice?.(index); }
      } else pressKey(action.digit);
    }
  };

  // Direct part edits compose the canonical 'M:SS' form.
  const setPart = (part: 'min' | 'sec', v: string) => {
    const digits = v.replace(/\D/g, '');
    const parts = durationParts(draft);
    updateDraft(part === 'min' ? `${digits}:${parts.sec}` : `${parts.min}:${digits.slice(0, 2)}`);
  };

  const placeholder = entry.domain === 'duration' ? '0:00' : entry.domain === 'integer' ? '0' : '0.0';
  const showGrid = entry.domain !== 'choice';
  const gridKeys: Array<{ id: string; label: string; key: string }> = [
    { id: 'entry-digit-7', label: '7', key: '7' },
    { id: 'entry-digit-8', label: '8', key: '8' },
    { id: 'entry-digit-9', label: '9', key: '9' },
    { id: 'entry-digit-4', label: '4', key: '4' },
    { id: 'entry-digit-5', label: '5', key: '5' },
    { id: 'entry-digit-6', label: '6', key: '6' },
    { id: 'entry-digit-1', label: '1', key: '1' },
    { id: 'entry-digit-2', label: '2', key: '2' },
    { id: 'entry-digit-3', label: '3', key: '3' },
    ...(entry.domain === 'decimal' ? [{ id: 'entry-dot', label: '.', key: '.' }] : []),
    { id: 'entry-digit-0', label: '0', key: '0' },
    { id: 'entry-back', label: '⌫', key: 'back' },
  ];

  useEffect(() => {
    setChoiceIndex(entry.selectedIndex ?? 0);
  }, [entry.selectedIndex]);

  return (
    <div ref={cardRef} data-clock-entry tabIndex={-1} onKeyDown={handleKey} className="flex w-full flex-col items-center gap-4 outline-none" aria-label={`Enter ${entry.label}`}>
      {entry.domain === 'choice' ? (
        <div className="flex w-full flex-col gap-3" role="radiogroup" aria-label={entry.label}>
          {alternatives.map((alt, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choiceIndex === i}
              data-testid={`entry-choice-${i}`}
              onClick={() => { setChoiceIndex(i); setLocalError(null); onChoice?.(i); }}
              {...fp(getFocusProps, `entry-choice-${i}`)}
              className={cn(
                'w-full rounded-xl border-2 px-6 py-4 text-lg font-bold transition-all',
                choiceIndex === i
                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                  : 'border-border bg-background text-foreground hover:border-primary/50',
              )}
            >
              {alt.label}
            </button>
          ))}
        </div>
      ) : entry.domain === 'duration' ? (
        <div className="flex items-center justify-center gap-2" onKeyDown={handleEnter}>
          <input
            data-testid="entry-min"
            aria-label="Minutes"
            inputMode="numeric"
            value={durationParts(draft).min}
            onChange={(e) => setPart('min', e.target.value)}
            className="w-24 rounded-lg border-2 border-border bg-background py-3 text-center text-3xl font-bold tabular-nums outline-none focus:border-primary"
          />
          <span className="text-3xl font-bold text-muted-foreground">:</span>
          <input
            data-testid="entry-sec"
            aria-label="Seconds"
            inputMode="numeric"
            value={durationParts(draft).sec}
            onChange={(e) => setPart('sec', e.target.value)}
            className="w-24 rounded-lg border-2 border-border bg-background py-3 text-center text-3xl font-bold tabular-nums outline-none focus:border-primary"
          />
        </div>
      ) : (
        <input
          data-testid="entry-value"
          aria-label={entry.label}
          inputMode={entry.domain === 'integer' ? 'numeric' : 'decimal'}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => updateDraft(e.target.value)}
          onKeyDown={handleEnter}
          className="w-full rounded-lg border-2 border-border bg-background py-3 text-center text-2xl font-bold tabular-nums outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      )}

      {shownError && (
        <p role="alert" className="text-sm font-medium text-destructive">{shownError}</p>
      )}

      {showGrid && (
        <div className="grid w-full max-w-[260px] grid-cols-3 gap-2" aria-label="Number pad">
          {gridKeys.map((key) => (
            <button
              key={key.id}
              type="button"
              data-testid={key.id}
              onClick={() => pressKey(key.key)}
              {...fp(getFocusProps, key.id)}
              className="min-h-[44px] rounded-lg border border-border bg-muted/30 text-xl font-bold tabular-nums transition-colors hover:bg-accent"
            >
              {key.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="entry-clear"
            onClick={() => pressKey('clear')}
            {...fp(getFocusProps, 'entry-clear')}
            className="col-span-3 min-h-[44px] rounded-lg border border-border text-xs font-bold uppercase tracking-label text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex w-full items-center justify-between gap-3">
        <button
          type="button"
          data-testid="entry-cancel"
          onClick={onCancel}
          {...fp(getFocusProps, 'entry-cancel')}
          className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          {onSkip && (
            <button
              type="button"
              data-testid="entry-skip"
              onClick={onSkip}
              {...fp(getFocusProps, 'entry-skip')}
              className="px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {skipLabel ?? 'Skip'}
            </button>
          )}
          <button
            type="button"
            data-testid="entry-save"
            onClick={commit}
            disabled={saving}
            {...fp(getFocusProps, 'entry-save')}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 font-bold text-primary-foreground shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
