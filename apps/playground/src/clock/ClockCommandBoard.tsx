/**
 * ClockCommandBoard — the shared snapshot/dispatch command board.
 *
 * Presentational + self-contained: everything it renders is driven by the
 * `snapshot` / `dispatch` props (registry-free), so the browser hosts and the
 * Cast receiver mount the exact same component. Owns no state beyond UI-local
 * mode/key-check toggles and the shared keyboard digit buffer.
 *
 * Exports `ClockKeyLegend`, `ClockControlModeToggle` and `ClockKeyCheckDialog`
 * separately for hosts that want only the chrome (receiver idle screen).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ClockValueEntry } from '@/clock/ClockValueEntry';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import {
  getClockKeyMode,
  setClockKeyMode,
  useClockDraft,
  useClockDraftError,
  writeClockDraft,
  type ClockCommand,
  type ClockKeyMode,
  type ClockSnapshot,
} from './clockCommands';

export interface ClockCommandBoardProps {
  snapshot: ClockSnapshot;
  dispatch: (command: ClockCommand) => boolean;
  className?: string;
  /** Receiver D-pad focus wiring; no-op (undefined) on plain browser hosts. */
  getFocusProps?: (id: string) => FocusProps;
}


const LEGEND_NAVIGATION = '⏎ Select · Pad⏎ Next · 8/2/4/6 Move · +/− Reps · * Values · / Play · Esc Stop';
const LEGEND_KEYPAD = '⏎ Next · Pad⏎ Next · 8/2/4/6 Move · +/− Reps · * Values · / Play · Esc Stop';

export function ClockKeyLegend({ mode, className }: { mode: ClockKeyMode; className?: string }): React.ReactElement {
  return (
    <p
      data-testid={TEST_IDS.CLOCK_LEGEND}
      className={`px-3 text-[10px] leading-4 text-muted-foreground ${className ?? ''}`}
    >
      {mode === 'keypad' ? LEGEND_KEYPAD : LEGEND_NAVIGATION}
    </p>
  );
}

export const ClockControlModeToggle: React.FC<{
  mode?: ClockKeyMode;
  onModeChange?: (mode: ClockKeyMode) => void;
  className?: string;
  /** Receiver D-pad focus wiring. */
  getFocusProps?: (id: string) => FocusProps;
}> = ({ mode, onModeChange, className, getFocusProps }) => {
  const [internalMode, setInternalMode] = useState<ClockKeyMode>(() => getClockKeyMode());
  const active = mode ?? internalMode;
  const select = (next: ClockKeyMode) => {
    setClockKeyMode(next);
    setInternalMode(next);
    onModeChange?.(next);
  };
  return (
    <div
      data-testid={TEST_IDS.CLOCK_KEY_MODE_TOGGLE}
      role="group"
      aria-label="Enter key mode"
      className={`inline-flex items-center rounded-full border border-border text-[10px] ${className ?? ''}`}
    >
      {(['navigation', 'keypad'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={active === m}
          onClick={() => select(m)}
          {...getFocusProps?.(`board-keymode-${m}`)}
          className={`rounded-full px-2 py-0.5 ${active === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {m === 'navigation' ? 'Nav' : 'Keypad'}
        </button>
      ))}
    </div>
  );
};

interface KeyEventRecord {
  key: string;
  code: string;
  location: number;
  keyCode: number;
  repeat: boolean;
  count: number;
}

/** Live `key`/`code`/`location`/repeat probe for the hardware acceptance pass.
 * While open it owns the foreground: the shared keyboard listener ignores all
 * clock keys (body[data-clock-modal]) so the probe cannot mutate the workout. */
export const ClockKeyCheckDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  getFocusProps?: (id: string) => FocusProps;
}> = ({ open, onClose, getFocusProps }) => {
  const [events, setEvents] = useState<KeyEventRecord[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    document.body.dataset.clockModal = 'key-check';
    const previous = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      delete document.body.dataset.clockModal;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'NumpadEnter' || e.location === 3) e.preventDefault();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      setEvents((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.key === e.key && last.code === e.code && last.location === e.location) {
          return [...prev.slice(0, -1), { ...last, repeat: e.repeat, count: last.count + 1 }];
        }
        return [
          ...prev.slice(-7),
          { key: e.key, code: e.code, location: e.location, keyCode: e.keyCode, repeat: e.repeat, count: 1 },
        ];
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4">
      <div
        data-testid={TEST_IDS.CLOCK_KEY_CHECK_DIALOG}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeRef.current?.focus(); } }}
        aria-label="Key check"
        tabIndex={-1}
        data-clock-panel
        className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-xl outline-none"
      >
        <p className="text-sm font-semibold">Key check</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Press keys to record delivered key / code / location / repeat. Num Lock on and off, keypad and main Enter.
        </p>
        <table className="mt-3 w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-medium">key</th>
              <th className="pr-2 font-medium">code</th>
              <th className="pr-2 font-medium">loc</th>
              <th className="pr-2 font-medium">keyCode</th>
              <th className="font-medium">repeat</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="pr-2">{ev.key}</td>
                <td className="pr-2">{ev.code}</td>
                <td className="pr-2">{ev.location}</td>
                <td className="pr-2">{ev.keyCode}×{ev.count}</td>
                <td>{ev.repeat ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            {...getFocusProps?.('board-keycheck-close')}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const ClockCommandBoard: React.FC<ClockCommandBoardProps> = ({
  snapshot,
  dispatch,
  className,
  getFocusProps,
}) => {
  const draft = useClockDraft();
  const draftError = useClockDraftError();
  const [mode, setMode] = useState<ClockKeyMode>(() => getClockKeyMode());
  const [keyCheckOpen, setKeyCheckOpen] = useState(false);

  const focus = (id: string) => getFocusProps?.(id);
  const entry = snapshot.entry;
  const previousField = useRef(entry?.fieldId ?? null);
  React.useLayoutEffect(() => {
    const field = entry?.fieldId ?? null;
    if (getFocusProps && previousField.current !== field) writeClockDraft('');
    previousField.current = field;
  }, [entry?.fieldId, getFocusProps]);
  const entryError = snapshot.error ?? draftError;
  const rep = snapshot.reps.find((r) => r.occurrenceId === snapshot.selectedOccurrenceId) ?? null;
  const showReps =
    snapshot.reps.length > 0 && (snapshot.phase === 'live' || snapshot.phase === 'collection');

  return (
    <div data-testid={TEST_IDS.CLOCK_COMMAND_BOARD} className={className}>
      {entryError !== null && (
        <p data-testid={TEST_IDS.CLOCK_ERROR} role="status" className="px-3 pt-1 text-xs text-destructive">
          {entryError}
        </p>
      )}
      {getFocusProps && snapshot.phase === 'ready' && entry === null && (
        <button
          type="button"
          {...focus('board-ready-start')}
          onClick={() => dispatch({ kind: 'ready-start' })}
          className="rounded-xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground focus-visible:ring-2"
        >
          Start Workout
        </button>
      )}


      {showReps && (
        <div
          data-testid={TEST_IDS.CLOCK_REP_COUNTER}
          className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm"
        >
          <span className="text-xs text-muted-foreground">Actual reps</span>
          <span data-testid={TEST_IDS.CLOCK_REP_VALUE} className="font-mono text-sm font-semibold">
            {rep?.actual ?? '—'}
            {rep?.target != null ? ` / Target ${rep.target}` : ''}
          </span>
          <button
            type="button"
            data-testid={TEST_IDS.CLOCK_REP_MINUS}
            aria-label="Remove one rep"
            className="h-7 w-7 rounded-full border border-border text-sm hover:bg-accent"
            {...focus(`board-reps-minus-${snapshot.selectedOccurrenceId ?? ''}`)}
            onClick={() =>
              dispatch({ kind: 'reps-adjust', occurrenceId: snapshot.selectedOccurrenceId ?? '', delta: -1 })
            }
          >
            −
          </button>
          <button
            type="button"
            data-testid={TEST_IDS.CLOCK_REP_PLUS}
            aria-label="Add one rep"
            className="h-7 w-7 rounded-full border border-border text-sm hover:bg-accent"
            {...focus(`board-reps-plus-${snapshot.selectedOccurrenceId ?? ''}`)}
            onClick={() =>
              dispatch({ kind: 'reps-adjust', occurrenceId: snapshot.selectedOccurrenceId ?? '', delta: 1 })
            }
          >
            +
          </button>
          {draft !== '' && entry === null && (
            <span
              data-testid={TEST_IDS.CLOCK_DRAFT_CHIP}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
            >
              {draft} <span className="text-muted-foreground">⏎ to set</span>
            </span>
          )}
          {snapshot.reps.length > 1 && (
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Counted movement">
              {snapshot.reps.map((r) => (
                <button
                  key={r.occurrenceId}
                  type="button"
                  data-testid={`${TEST_IDS.CLOCK_REP_SELECT}-${r.occurrenceId}`}
                  aria-pressed={r.occurrenceId === snapshot.selectedOccurrenceId}
                  {...focus(`board-reps-${r.occurrenceId}`)}
                  onClick={() => dispatch({ kind: 'reps-select', occurrenceId: r.occurrenceId })}
                  className={`max-w-[9rem] truncate rounded-full border px-2 py-0.5 text-[11px] ${
                    r.occurrenceId === snapshot.selectedOccurrenceId
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </span>
          )}
          <button
            type="button"
            data-testid={TEST_IDS.CLOCK_VALUES_BUTTON}
            className="ml-auto rounded-full border border-border px-2.5 py-0.5 text-[11px] hover:bg-accent"
            {...focus('board-values')}
            onClick={() => dispatch({ kind: 'values-open' })}
          >
            Values *
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <ClockKeyLegend mode={mode} className="min-w-0 flex-1 truncate" />
        <ClockControlModeToggle
          mode={mode}
          onModeChange={setMode}
          getFocusProps={getFocusProps}
          className="mr-2 shrink-0"
        />
        <button
          type="button"
          data-testid={TEST_IDS.CLOCK_KEY_CHECK_BUTTON}
          className="mr-2 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          {...focus('board-key-check')}
          onClick={() => setKeyCheckOpen(true)}
        >
          Keys?
        </button>
      </div>

      {entry !== null && (
        <div
          data-testid={TEST_IDS.CLOCK_ENTRY_OVERLAY}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 p-4"
        >
          {/* data-clock-entry scopes the entry card's own key handling: the
              shared keyboard listener ignores events from inside this card so
              the card's Enter/Save never double-dispatches. */}
          <div data-clock-entry role="dialog" aria-modal="true" aria-label={`Enter ${entry.label}`} className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
            <p className="mb-1 text-sm font-semibold">{entry.label}</p>
            <p className="mb-3 text-xs text-muted-foreground">
              {entry.intent === 'actual' ? 'Actual' : 'Target'} {entry.metricType}{entry.unit ? ` · ${entry.unit}` : ''} · {snapshot.status}
            </p>
            <ClockValueEntry
              key={entry.fieldId}
              entry={entry}
              saving={snapshot.saving}
              error={entryError}
              draft={draft}
              onSave={(value) => { dispatch({ kind: 'entry-save', fieldId: entry.fieldId, value }); }}
              onCancel={() => dispatch({ kind: 'entry-cancel' })}
              onSkip={
                entry.required
                  ? undefined
                  : () => dispatch({ kind: 'entry-skip', fieldId: entry.fieldId })
              }
              onChoice={(index) => dispatch({ kind: 'choice-select', fieldId: entry.fieldId, index })}
              onDraftChange={writeClockDraft}
              getFocusProps={getFocusProps}
            />
          </div>
        </div>
      )}

      {snapshot.stopRequested && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4">
          <div
            data-testid={TEST_IDS.CLOCK_STOP_CONFIRM}
            role="alertdialog"
            aria-label="Stop workout?"
            aria-modal="true"
            className="w-full max-w-sm rounded-lg border border-border bg-background p-4 text-center shadow-xl"
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const controls = e.currentTarget.querySelectorAll<HTMLButtonElement>('button');
                (document.activeElement === controls[0] ? controls[1] : controls[0])?.focus();
              }
            }}
          >
            <p className="text-sm font-semibold">Stop workout?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Partial results are saved. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                autoFocus
                data-testid={TEST_IDS.CLOCK_STOP_CONFIRM_CANCEL}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                {...focus('board-stop-cancel')}
                onClick={() => dispatch({ kind: 'stop-cancel' })}
              >
                Keep going
              </button>
              <button
                type="button"
                data-testid={TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                {...focus('board-stop-confirm')}
                onClick={() => dispatch({ kind: 'stop-confirm' })}
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <ClockKeyCheckDialog open={keyCheckOpen} onClose={() => setKeyCheckOpen(false)} getFocusProps={getFocusProps} />
    </div>
  );
};
