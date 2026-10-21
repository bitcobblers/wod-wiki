import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  type CollectionItem,
  type ValueIntent,
  entryFieldId,
  toClockEntry,
} from '@/hooks/useCollectionMetrics';
import { ClockValueEntry, validateEntryValue } from '@/clock/ClockValueEntry';
import {
  type ClockCommand,
  type ClockSnapshot,
  useClockController,
  useClockDraft,
  writeClockDraft,
} from '@/clock/clockCommands';
import { cn } from '@/lib/utils';

export interface CollectionWizardProps {
  items: CollectionItem[];
  /**
   * Saves one field. May return a promise / `false`: the wizard stays on the
   * field (draft preserved) until the save confirms. A plain `void` return
   * counts as success. `intent` is explicit: pre-run answers are 'target';
   * deferred fields never reach onSave (they stay hinted for post-run).
   * Save never advances the workout.
   */
  onSave: (item: CollectionItem, value: unknown, intent: ValueIntent) => void | boolean | Promise<unknown>;
  /** Optional skip — defers pre-run deferrables / drops post-run prompts. */
  onSkip?: (item: CollectionItem) => void;
  /** Started from the Ready panel — a separate, explicit start action. */
  onStart?: () => void;
  onClose?: () => void;
  mode: 'pre-run' | 'post-run';
  /** Clock registry runId; defaults per mode. */
  runId?: string;
  className?: string;
}

/**
 * CollectionWizard — field-by-field target/actual collection on the clock.
 *
 * Registers a clock command controller (pre-run 10, post-run 20) so browser
 * keyboard, Cast receiver, and on-screen controls drive the same entry; the
 * shared {@link ClockValueEntry} renders and validates every field. Pending
 * items are tracked by a stable answered-set (never index arithmetic), so a
 * parent that shrinks the list and a parent that keeps it fixed behave
 * identically. Drafts are keyed by stable field id and preserved across
 * navigation and errors.
 */
const CollectionWizard: React.FC<CollectionWizardProps> = ({
  items,
  onSave,
  onSkip,
  onStart,
  onClose,
  mode,
  runId,
  className,
}) => {
  // Stable settled-set model: a field leaves the pending list only here or
  // when the parent shrinks `items` — never both racing on an index.
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0); // position within the pending list (Back navigation)
  // Drafts + selections keyed by stable field id, never array position.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [choiceSelections, setChoiceSelections] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const busyRef = useRef(false);
  const engagedRef = useRef(false);
  if (items.length > 0) engagedRef.current = true;

  // One shared draft path: the shared keyboard buffer mirrors the current
  // field's draft. Buffer → map (keyboard edits), map → buffer (grid edits).
  const sharedDraft = useClockDraft();

  const pendingItems = useMemo(
    () => items.filter((item) => !settled.has(entryFieldId(item))),
    [items, settled],
  );
  const clampedCursor = Math.min(cursor, Math.max(pendingItems.length - 1, 0));
  const currentItem = pendingItems[clampedCursor];
  const fieldId = currentItem ? entryFieldId(currentItem) : null;
  // Ready to start: every pre-run field is resolved or explicitly deferred —
  // required execution fields always block (they are never deferrable).
  const readyToStart = mode === 'pre-run' && pendingItems.length === 0 && engagedRef.current;

  useEffect(() => {
    if (fieldId && typeof sharedDraft === 'string') {
      setDrafts((prev) => (prev[fieldId] === sharedDraft ? prev : { ...prev, [fieldId]: sharedDraft }));
    }
  }, [sharedDraft, fieldId]);

  const clearFieldDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setChoiceSelections((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // The field settled — release the shared keyboard buffer too (it is
    // cleared only here, on confirmed settle, never at dispatch).
    writeClockDraft('');
  }, []);

  const setDraft = useCallback((id: string, text: string) => {
    setDrafts((prev) => ({ ...prev, [id]: text }));
    writeClockDraft(text);
  }, []);

  /**
   * Commit one field with an explicit intent. Synchronous duplicate gate:
   * while a save is in flight the field stays put and re-entrant commits are
   * dropped before any await. The field only settles on confirmed success.
   */
  const commitValue = useCallback(async (item: CollectionItem, rawValue: number): Promise<boolean> => {
    if (busyRef.current) return false;
    const id = entryFieldId(item);
    const check = validateEntryValue(toClockEntry(item, 0, items.length), rawValue);
    if (!check.ok) {
      setSaveError(check.reason);
      return false;
    }
    busyRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const confirmed = await onSave(item, check.value, item.intent);
      if (confirmed === false) throw new Error('Save was rejected');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err)); // same field, draft preserved
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
    clearFieldDraft(id);
    setSettled((prev) => new Set(prev).add(id));
    return true;
  }, [onSave, items.length, clearFieldDraft]);

  /** Defer/drop the current field (post-run skip, pre-run "log later"). */
  const deferCurrent = useCallback(() => {
    if (!currentItem || busyRef.current) return;
    const id = entryFieldId(currentItem);
    if (mode === 'pre-run' && !currentItem.deferrable) return; // execution-only blocks Start
    clearFieldDraft(id);
    if (mode === 'post-run' && onSkip) onSkip(currentItem);
    setDeferred((prev) => new Set(prev).add(id));
    setSettled((prev) => new Set(prev).add(id));
  }, [currentItem, mode, onSkip, clearFieldDraft]);

  // ── Clock controller (priority: pre-run 10, post-run 20) ────────────────
  const handleCommand = useCallback((command: ClockCommand): boolean => {
    switch (command.kind) {
      case 'entry-save': {
        if (!currentItem || busyRef.current) return false;
        // Stale-snapshot guard: the command must address the CURRENT field.
        if (command.fieldId !== entryFieldId(currentItem)) return false;
        void commitValue(currentItem, command.value);
        return true;
      }
      case 'entry-cancel': {
        if (!currentItem) return false;
        setDraft(entryFieldId(currentItem), '');
        setSaveError(null);
        return true;
      }
      case 'entry-skip': {
        if (!currentItem || busyRef.current) return false;
        if (command.fieldId !== entryFieldId(currentItem)) return false;
        deferCurrent();
        return true;
      }
      case 'choice-select': {
        if (!currentItem || currentItem.kind !== 'choice') return false;
        if (command.fieldId !== entryFieldId(currentItem)) return false;
        if (!Number.isInteger(command.index) || command.index < 0) return false;
        if (command.index >= currentItem.alternatives.length) return false;
        setChoiceSelections((prev) => ({ ...prev, [entryFieldId(currentItem)]: command.index }));
        setSaveError(null);
        return true;
      }
      case 'ready-start': {
        // Required execution fields always block Start.
        if (!readyToStart) return false;
        onStart?.();
        return true;
      }
      case 'dismiss': {
        // Pre-run dismissal must not bypass the Start gate.
        if (mode === 'pre-run' && !readyToStart) return false;
        setDismissed(true);
        onClose?.();
        return true;
      }
      default:
        return false;
    }
  }, [currentItem, commitValue, deferCurrent, readyToStart, onStart, onClose, mode, setDraft]);

  const snapshot = useMemo<ClockSnapshot | null>(() => {
    if (pendingItems.length === 0) {
      // Pre-run Ready state stays addressable so remote Start works.
      if (readyToStart && !dismissed) {
        return {
          runId: runId ?? 'collection:pre-run',
          phase: 'ready',
          status: 'idle',
          canNext: false,
          canStop: false,
          stopRequested: false,
          reps: [],
          selectedOccurrenceId: null,
          entry: null,
          error: null,
          saving: false,
        };
      }
      return null;
    }
    const entry = currentItem ? toClockEntry(currentItem, clampedCursor, pendingItems.length) : null;
    return {
      runId: runId ?? (mode === 'pre-run' ? 'collection:pre-run' : 'collection:post-run'),
      phase: mode === 'pre-run' ? 'ready' : 'collection',
      status: 'idle',
      canNext: false,
      canStop: false,
      stopRequested: false,
      reps: [],
      selectedOccurrenceId: null,
      entry: entry && currentItem && currentItem.kind === 'choice'
        ? { ...entry, selectedIndex: choiceSelections[entry.fieldId] ?? 0 }
        : entry,
      error: saveError,
      saving,
    };
  }, [pendingItems.length, currentItem, clampedCursor, mode, runId, choiceSelections, saveError, saving, readyToStart, dismissed]);

  useClockController(snapshot, handleCommand, mode === 'pre-run' ? 10 : 20, { keyboard: true });

  const requestDismiss = useCallback(() => {
    if (mode === 'pre-run' && !readyToStart) return; // keep the Start gate honest
    setDismissed(true);
    onClose?.();
  }, [mode, readyToStart, onClose]);

  // ── Empty states ──────────────────────────────────────────────────────────
  if (pendingItems.length === 0) {
    // Post-run queue drains straight into review; only pre-run has a Ready step.
    if (readyToStart && !dismissed) {
      return (
        <div className={cn(
          'flex flex-col items-center justify-center gap-6 rounded-2xl border border-border bg-card p-8 text-center shadow-xl',
          className,
        )}>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Ready to Start</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Targets are set{deferred.size > 0 ? ` — ${deferred.size} logged after your workout` : ''}.
            </p>
          </div>
          {onStart && (
            <button
              type="button"
              data-testid="collection-start"
              onClick={onStart}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground shadow-lg transition-all hover:brightness-110"
            >
              Start Workout
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      );
    }
    return null;
  }
  if (!currentItem) return null;

  const itemEntry = toClockEntry(currentItem, clampedCursor, pendingItems.length);
  const choiceIndex = currentItem.kind === 'choice' ? (choiceSelections[itemEntry.fieldId] ?? 0) : 0;
  const canDefer = mode === 'post-run' || currentItem.deferrable;

  return (
    <div className={cn(
      'flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl',
      mode === 'pre-run' ? 'fixed inset-0 z-50 md:inset-10' : 'relative',
      className,
    )}>
      {/* Progress Bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((items.length - pendingItems.length + 1) / (items.length + 1)) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/10 px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">
            {mode === 'pre-run' ? 'Set Your Targets' : 'Fill in your actuals'}
          </h2>
          <p className="text-xs uppercase tracking-label text-muted-foreground">
            {items.length - pendingItems.length + 1} of {items.length} metrics
          </p>
        </div>
        <div className="flex items-center gap-1">
          {clampedCursor > 0 && (
            <button
              type="button"
              data-testid="collection-back"
              onClick={() => { setCursor(clampedCursor - 1); setSaveError(null); }}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          {onClose && mode === 'post-run' && (
            <button type="button" onClick={requestDismiss} className="rounded-full p-2 transition-colors hover:bg-muted">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center w-full max-w-md mx-auto p-8">
        <div className="w-full space-y-6">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-pill border border-metric-effort/40 bg-metric-effort/15 px-3 py-1 text-xs font-bold text-metric-effort">
              {mode === 'pre-run' ? 'Target' : 'Actual'} · {currentItem.exerciseLabel}
            </div>
            {(currentItem.setIndex || currentItem.roundIndex) && (
              <div className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">
                {currentItem.roundIndex && `Round ${currentItem.roundIndex}`}
                {currentItem.roundIndex && currentItem.setIndex && ' · '}
                {currentItem.setIndex && `Set ${currentItem.setIndex}`}
              </div>
            )}
          </div>
          <ClockValueEntry
            key={itemEntry.fieldId}
            entry={currentItem.kind === 'choice' ? { ...itemEntry, selectedIndex: choiceIndex } : itemEntry}
            saving={saving}
            error={saveError}
            onSave={(value) => void commitValue(currentItem, value)}
            onCancel={() => {
              setDraft(itemEntry.fieldId, '');
              setSaveError(null);
            }}
            onSkip={canDefer ? deferCurrent : undefined}
            skipLabel={mode === 'pre-run' ? 'Log after workout' : 'Skip'}
            onChoice={currentItem.kind === 'choice' ? (index) => setChoiceSelections((prev) => ({ ...prev, [itemEntry.fieldId]: index })) : undefined}
            onDraftChange={(text) => setDraft(itemEntry.fieldId, text)}
            initialDraft={drafts[itemEntry.fieldId] ?? ''}
          />
        </div>
      </div>

      {saveError && (
        <div className="flex items-center gap-2 border-t border-border bg-warning/10 px-6 py-2 text-sm text-warning">
          <AlertCircle className="h-4 w-4" />
          <span role="alert">{saveError} — your entry is kept.</span>
        </div>
      )}
    </div>
  );
};

export { CollectionWizard };
