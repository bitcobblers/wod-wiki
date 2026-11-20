import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isPipelineQuery, resolveWqlCursorStage, type AnyParsedQuery, type WqlCursorStageInfo } from '@bitcobblers/wod-wiki-wql';
import { useClauseItems } from './clauseItems';
import { composerRegistry, useComposerSlots } from './ComposerRegistry';
import { astToPills, editQueryClause, pivotQuery, resolveQueryDraft, type QueryDraft } from './queryAst';
import { CLAUSE_META, CONTENT_GROUPING_DIMENSIONS, allowedFilterTypesForTarget, getClauseMeta, type ClauseType, type QueryClause } from './queryClauses';
import { buildAddableFilterGroups, buildScopeZones, getClauseZone, type QueryZone } from './queryZones';
import { useSuggestionBoundTypes } from './suggestionSources';
import { useWqlStageCounts, DEFAULT_DIAGNOSTICS_DEBOUNCE_MS, type WqlExecutor, type WqlStageCounts } from './useWqlStageCounts';
import type { WqlSlotActivation } from './WqlTextEditor';

export interface WqlValidationState {
  valid: boolean;
  error?: string;
}

export interface WqlSegmentEditRequest {
  type: ClauseType;
  /** Change the token to repeat a request for the same segment. */
  token: number;
}

export type ActiveEditor =
  | { kind: 'closed' }
  | { kind: 'scope' }
  | { kind: 'value'; clause: QueryClause; range?: { from: number; to: number }; closeSurfaceOnCommit?: boolean }
  | { kind: 'add-filter'; closeSurfaceOnCommit?: boolean };

export interface UseWqlComposerOptions {
  initialQuery?: string;
  query?: string;
  onQueryChange?: (wql: string) => void;
  onValidationChange?: (state: WqlValidationState) => void;
  onAstChange?: (ast: AnyParsedQuery) => void;
  onSubmit?: (wql: string) => void;
  compact?: boolean;
  defaultExpanded?: boolean;
  surface?: 'popover' | 'inline' | 'sheet';
  execute?: WqlExecutor;
  stages?: WqlStageCounts;
  debounceMs?: number;
  hiddenClauseTypes?: ClauseType[];
  preferredChoices?: readonly string[];
  segmentEditRequest?: WqlSegmentEditRequest;
  onScopeOpenChange?: (open: boolean) => void;
}

function matchSlotToPill(slot: WqlSlotActivation, pills: readonly QueryClause[]): QueryClause | undefined {
  if (slot.filterIndex !== undefined) {
    return pills.find((pill) => pill.filterIndex === slot.filterIndex);
  }
  if (slot.node === 'GroupBy') return pills.find((pill) => pill.type === 'groupby');
  if (slot.node === 'Rollup') return pills.find((pill) => pill.type === 'rollup');
  if (slot.node === 'Time') return pills.find((pill) => pill.type === 'time');
  if (slot.node === 'Unit') return pills.find((pill) => pill.type === 'unit');
  if (slot.node === 'Head') {
    if (slot.headPart) return pills.find((pill) => pill.type === slot.headPart);
    return pills.find((pill) => ['kind', 'target', 'agg', 'metric'].includes(pill.type) && pill.value === slot.text);
  }
  return undefined;
}

/** Shared state machine for WqlComposer (Split-Pills <-> single WqlTextEditor + Scope Map). */
export function useWqlComposerController({
  initialQuery,
  query,
  onQueryChange,
  onValidationChange,
  onAstChange,
  onSubmit,
  compact = false,
  defaultExpanded,
  surface,
  execute,
  stages: suppliedStages,
  debounceMs = DEFAULT_DIAGNOSTICS_DEBOUNCE_MS,
  hiddenClauseTypes,
  preferredChoices,
  segmentEditRequest,
  onScopeOpenChange,
}: UseWqlComposerOptions) {
  const effectiveSurface = surface ?? (compact ? 'popover' : 'inline');
  const expandedByDefault = defaultExpanded ?? !compact;

  const [base, setBase] = useState(query ?? initialQuery ?? ':note');
  const [active, setActive] = useState<ActiveEditor>(() => (expandedByDefault ? { kind: 'scope' } : { kind: 'closed' }));
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<string>();
  const [pivot, setPivot] = useState<{ draft: QueryDraft; removed: string[] }>();
  const [cursorStage, setCursorStage] = useState<WqlCursorStageInfo | undefined>(() =>
    resolveWqlCursorStage(query ?? initialQuery ?? ':note', 0),
  );
  const [caretClauseId, setCaretClauseId] = useState<string | null>(null);
  const [focusEditorFlag, setFocusEditorFlag] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const scopeToggleRef = useRef<HTMLButtonElement>(null);
  const lastClauseTypeRef = useRef<string | null>(null);
  const emittedRef = useRef(query ?? initialQuery ?? ':note');
  const queryRef = useRef(query);
  const currentRef = useRef(resolveQueryDraft(base));
  const callbacks = useRef({ onQueryChange, onValidationChange, onAstChange, onScopeOpenChange });
  callbacks.current = { onQueryChange, onValidationChange, onAstChange, onScopeOpenChange };

  const id = useId();
  const listId = `${id}-options`;
  const slots = useComposerSlots();
  const boundTypes = useSuggestionBoundTypes();

  const external = query !== undefined && query !== queryRef.current && query !== emittedRef.current;
  const resolved = useMemo(() => resolveQueryDraft(external ? query : base), [base, external, query]);
  currentRef.current = resolved;

  const pills = useMemo(() => astToPills(resolved.ast) ?? [], [resolved.ast]);
  const guided = resolved.valid && astToPills(resolved.ast) !== null;
  const hidden = useMemo(() => new Set<string>(hiddenClauseTypes), [hiddenClauseTypes]);

  const editorClause = active.kind === 'value' ? active.clause : undefined;
  const customEditor = editorClause ? composerRegistry.getSlot(editorClause.type) : undefined;
  const supportedValues =
    editorClause?.type === 'groupby' && resolved.ast.family === 'find' && ['note', 'block'].includes(resolved.ast.target)
      ? CONTENT_GROUPING_DIMENSIONS
      : undefined;

  const values = useClauseItems(editorClause, search, { supportedValues });
  const preferredItems = useMemo(
    () =>
      [...values.filteredItems].sort((a, b) => {
        const ai = preferredChoices?.indexOf(a.value) ?? -1;
        const bi = preferredChoices?.indexOf(b.value) ?? -1;
        return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
      }),
    [values.filteredItems, preferredChoices],
  );

  const allowed = useMemo(
    () =>
      isPipelineQuery(resolved.ast)
        ? new Set<string>()
        : allowedFilterTypesForTarget(resolved.ast.family === 'find' ? resolved.ast.target : '', resolved.ast.family),
    [resolved.ast],
  );

  const astWindow = isPipelineQuery(resolved.ast) ? undefined : resolved.ast.window;
  const draftWindow = () => {
    const draft = currentRef.current.ast;
    return isPipelineQuery(draft) ? undefined : draft.window;
  };

  const factTarget =
    resolved.ast.family === 'aggregate' || (resolved.ast.family === 'find' && ['segment', 'event'].includes(resolved.ast.target));
  const dynamicTypes = useMemo(
    () => (factTarget ? boundTypes.filter((type) => !(type in CLAUSE_META)) : []),
    [factTarget, boundTypes],
  );
  const customSlotTypes = useMemo(() => new Set(slots.map((s) => s.type)), [slots]);

  const catalogTypes = useMemo(
    () =>
      [...Object.keys(CLAUSE_META), ...dynamicTypes, ...slots.map((slot) => slot.type)]
        .filter((type, index, all) => all.indexOf(type) === index && !hidden.has(type))
        .filter((type) => allowed.has(type) || dynamicTypes.includes(type) || customSlotTypes.has(type))
        .filter((type) => type !== 'target' && type !== 'kind' && type !== 'pipes' && type !== 'where'),
    [allowed, customSlotTypes, dynamicTypes, hidden, slots],
  );

  const addableGroups = useMemo(
    () => buildAddableFilterGroups(catalogTypes, search, customSlotTypes),
    [catalogTypes, customSlotTypes, search],
  );
  const flatAddable = useMemo(() => addableGroups.flatMap((g) => g.items), [addableGroups]);

  const zones = useMemo(
    () => buildScopeZones(pills, resolved.ast, allowed, hidden),
    [pills, resolved.ast, allowed, hidden],
  );

  const visiblePills = useMemo(() => zones.flatMap((z) => z.clauses), [zones]);
  const ignoredClauses = useMemo(() => visiblePills.filter((c) => c.invalid), [visiblePills]);

  const isScopeOpen = !guided || active.kind !== 'closed';
  const activeClause = active.kind === 'value' ? active.clause : undefined;
  const activeZone: QueryZone | undefined =
    active.kind === 'value'
      ? getClauseZone(active.clause.type)
      : active.kind === 'add-filter'
        ? 'where'
        : undefined;
  const caretClause = caretClauseId ? visiblePills.find((p) => p.id === caretClauseId) : undefined;
  const caretZone: QueryZone | undefined = caretClause ? caretClause.zone : undefined;

  const countedStages = useWqlStageCounts(resolved.ast, resolved.valid && !error, suppliedStages ? undefined : execute, debounceMs);
  const stages = suppliedStages ?? countedStages;

  useEffect(() => {
    if (query === undefined || query === queryRef.current) return;
    queryRef.current = query;
    if (query === emittedRef.current) return;
    emittedRef.current = query;
    setBase(query);
    setActive(expandedByDefault ? { kind: 'scope' } : { kind: 'closed' });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
    setPivot(undefined);
  }, [query, expandedByDefault]);

  useEffect(() => {
    callbacks.current.onValidationChange?.({
      valid: resolved.valid && !error && !pivot,
      error: error ?? resolved.error ?? (pivot ? 'Confirm or cancel the query change' : undefined),
    });
    callbacks.current.onAstChange?.(resolved.ast);
  }, [resolved, error, pivot]);

  useEffect(() => {
    callbacks.current.onScopeOpenChange?.(isScopeOpen);
  }, [isScopeOpen]);

  useEffect(() => {
    if (active.kind === 'value' || active.kind === 'add-filter') {
      pickerRef.current?.focus();
    }
  }, [active]);

  useEffect(() => {
    if (!focusEditorFlag || !isScopeOpen) return;
    setFocusEditorFlag(false);
    const dom = rootRef.current?.querySelector<HTMLElement>('[data-testid="wql-text-input"]');
    dom?.focus();
  }, [focusEditorFlag, isScopeOpen]);

  useEffect(() => {
    if (highlight >= 0) {
      document.getElementById(`${listId}-option-${highlight}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlight, listId]);

  // Outside click closes floating popover cleanly back to Split-Pills.
  useEffect(() => {
    if (effectiveSurface !== 'popover' || !isScopeOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.cm-tooltip')) return;
      setActive({ kind: 'closed' });
      setSearch('');
      setHighlight(-1);
      setError(undefined);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [effectiveSurface, isScopeOpen]);

  const notify = (draft: QueryDraft) => {
    currentRef.current = draft;
    const changed = draft.wql !== emittedRef.current;
    emittedRef.current = draft.wql;
    callbacks.current.onValidationChange?.({ valid: draft.valid, error: draft.error });
    callbacks.current.onAstChange?.(draft.ast);
    if (changed) callbacks.current.onQueryChange?.(draft.wql);
  };

  const commit = (draft: QueryDraft) => {
    setBase(draft.wql);
    setError(undefined);
    notify(draft);
  };

  const focusSlotButton = (clauseType: string | null) => {
    const focusNow = () => {
      const root = rootRef.current;
      if (!root) return false;
      const selector = clauseType
        ? `[data-testid="token-slot-${clauseType}"]`
        : '[data-testid="wql-add-filter-btn"]';
      const target = root.querySelector<HTMLElement>(selector) ?? scopeToggleRef.current;
      if (!target) return false;
      target.focus();
      return document.activeElement === target;
    };
    if (!focusNow()) {
      requestAnimationFrame(() => {
        focusNow();
      });
    }
  };

  const openScope = (focusText = false) => {
    setActive({ kind: 'scope' });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
    if (focusText) setFocusEditorFlag(true);
  };

  const closeScope = (restoreFocus = true) => {
    const lastType = lastClauseTypeRef.current;
    setActive(expandedByDefault ? { kind: 'scope' } : { kind: 'closed' });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
    if (restoreFocus) {
      focusSlotButton(lastType);
    }
  };

  const closeInspector = (restoreFocus = true) => {
    const lastType = active.kind === 'add-filter' ? null : (active.kind === 'value' ? active.clause.type : lastClauseTypeRef.current);
    setActive({ kind: 'scope' });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
    if (restoreFocus) {
      focusSlotButton(lastType);
    }
  };

  const openEditor = (
    clause: QueryClause,
    range?: { from: number; to: number },
    closeSurfaceOnCommit = active.kind === 'closed',
  ) => {
    lastClauseTypeRef.current = clause.type;
    setActive({ kind: 'value', clause, range, closeSurfaceOnCommit });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
  };

  const openAddFilter = (closeSurfaceOnCommit = active.kind === 'closed') => {
    lastClauseTypeRef.current = null;
    setActive({ kind: 'add-filter', closeSurfaceOnCommit });
    setSearch('');
    setHighlight(-1);
    setError(undefined);
  };

  const openField = (type: string, closeSurfaceOnCommit = false) => {
    const existing = pills.find((pill) => pill.type === type);
    openEditor(
      existing ?? { id: `new-${type}`, type, ...getClauseMeta(type), value: '' },
      undefined,
      closeSurfaceOnCommit,
    );
  };

  const openFieldRef = useRef(openField);
  openFieldRef.current = openField;
  useEffect(() => {
    if (segmentEditRequest) openFieldRef.current(segmentEditRequest.type, false);
  }, [segmentEditRequest]);

  const handleCursorClauseChange = (slot: WqlSlotActivation | null) => {
    if (!slot) {
      setCaretClauseId(null);
      return;
    }
    const matched = matchSlotToPill(slot, pills);
    setCaretClauseId(matched?.id ?? null);
  };

  const activateWqlSlot = (slot: WqlSlotActivation) => {
    const clause = matchSlotToPill(slot, pills);
    if (clause) openEditor(clause, { from: slot.from, to: slot.to }, false);
  };

  const moveEditor = (direction: 1 | -1): boolean => {
    if (active.kind !== 'value') return false;
    const index = visiblePills.findIndex((pill) => pill.id === active.clause.id);
    const next = visiblePills[index + direction];
    if (!next) return false;
    openEditor(next, undefined, active.closeSurfaceOnCommit);
    return true;
  };

  const updateClause = (clause: QueryClause, value: string | null) => {
    if (clause.type === 'kind' || clause.type === 'target') {
      const next = pivotQuery(currentRef.current.wql, clause.type, value ?? '');
      if (!next.draft.valid) {
        setError(next.draft.error);
        return;
      }
      if (next.removed.length) {
        setPivot(next);
        return;
      }
      commit(next.draft);
      if (active.kind === 'value' && active.closeSurfaceOnCommit && !expandedByDefault) closeScope(true);
      else closeInspector(true);
      return;
    }
    const next = editQueryClause(currentRef.current.wql, clause, value);
    if (!next.valid) {
      setError(next.error);
      return;
    }
    commit(next);
    if (active.kind === 'value') {
      const previousIndex = clause.filterIndex;
      const updated = astToPills(next.ast)?.find((pill) =>
        previousIndex !== undefined ? pill.filterIndex === previousIndex && Boolean(value) : pill.type === clause.type,
      );
      setActive({
        kind: 'value',
        clause: updated ?? { ...clause, value: value ?? '', filterIndex: undefined },
        closeSurfaceOnCommit: active.closeSurfaceOnCommit,
      });
    }
  };

  const removeClause = (clause: QueryClause) => {
    setUndo(currentRef.current.wql);
    const next = editQueryClause(currentRef.current.wql, clause, null);
    if (next.valid) commit(next);
    if (active.kind === 'value' && active.clause.id === clause.id) {
      setActive(expandedByDefault || isScopeOpen ? { kind: 'scope' } : { kind: 'closed' });
    }
  };

  const removeAllIgnored = () => {
    if (!ignoredClauses.length) return;
    setUndo(currentRef.current.wql);
    let working = currentRef.current.wql;
    // Remove from highest filterIndex down so earlier indices remain stable.
    const sorted = [...ignoredClauses].sort((a, b) => (b.filterIndex ?? -1) - (a.filterIndex ?? -1));
    for (const clause of sorted) {
      const next = editQueryClause(working, clause, null);
      if (next.valid) working = next.wql;
    }
    commit(resolveQueryDraft(working));
    if (active.kind === 'value' && ignoredClauses.some((c) => c.id === active.clause.id)) {
      setActive({ kind: 'scope' });
    }
  };

  const chooseValue = (value: string) => {
    if (active.kind !== 'value') return;
    if (values.isMulti) {
      const selected = values.selectedValues;
      const wildcard = active.clause.value !== '' && active.clause.value.split('|').every((item) => item.endsWith('*'));
      const picked = wildcard && !value.endsWith('*') ? `${value}*` : value;
      const nextList = selected.includes(picked) ? selected.filter((item) => item !== picked) : [...selected, picked];
      updateClause(active.clause, nextList.join('|'));
      return;
    }
    const next = editQueryClause(currentRef.current.wql, active.clause, value);
    if (!next.valid) {
      setError(next.error);
      return;
    }
    updateClause(active.clause, value);
    if (!['kind', 'target'].includes(active.clause.type)) {
      if (active.closeSurfaceOnCommit && !expandedByDefault) closeScope(true);
      else closeInspector(true);
    }
  };

  const submit = () => {
    const draft = currentRef.current;
    if (!draft.valid || error || pivot) return;
    commit(draft);
    onSubmit?.(draft.wql);
  };

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (active.kind === 'value' && event.key === 'Tab' && !event.nativeEvent.isComposing) {
      if (moveEditor(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      if (pivot) {
        event.preventDefault();
        event.stopPropagation();
        setPivot(undefined);
        return;
      }
      if (active.kind === 'value' || active.kind === 'add-filter') {
        event.preventDefault();
        event.stopPropagation();
        closeInspector(true);
        return;
      }
      if (active.kind === 'scope' && !expandedByDefault) {
        event.preventDefault();
        event.stopPropagation();
        closeScope(true);
        return;
      }
    }

    const optionTotal =
      active.kind === 'value'
        ? values.filteredItems.length + Number(values.canCommitTyped)
        : active.kind === 'add-filter'
          ? flatAddable.length
          : 0;

    if (optionTotal > 0 && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setHighlight((index) => (event.key === 'ArrowDown' ? (index + 1) % optionTotal : index <= 0 ? optionTotal - 1 : index - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (active.kind === 'add-filter') {
        const picked = flatAddable[highlight >= 0 ? highlight : 0];
        if (picked) openField(picked.type, active.closeSurfaceOnCommit);
        return;
      }
      if (active.kind === 'value') {
        if (highlight >= 0 && highlight < preferredItems.length) {
          chooseValue(preferredItems[highlight]!.value);
        } else if (values.canCommitTyped && (highlight === preferredItems.length || highlight < 0)) {
          chooseValue(values.typedValue);
        } else if (search && !values.openSlot) {
          setError(`Unknown ${getClauseMeta(active.clause.type).label} value`);
        }
        return;
      }
      submit();
    }
  };

  const handlePillRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && isScopeOpen && !expandedByDefault) {
      event.preventDefault();
      event.stopPropagation();
      closeScope(true);
      return;
    }
    if (!(event.target instanceof HTMLButtonElement)) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const container = event.currentTarget;
      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-testid^="token-slot-"]:not([data-testid^="token-slot-remove-"]):not([data-testid^="token-slot-value-"]), [data-testid="wql-add-filter-btn"], [data-testid^="wql-implicit-"]',
        ),
      );
      const index = buttons.indexOf(event.target);
      if (index >= 0 && buttons.length > 0) {
        event.preventDefault();
        const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const testId = event.target.getAttribute('data-testid');
      if (!testId?.startsWith('token-slot-')) return;
      const type = testId.replace('token-slot-', '');
      const pill = visiblePills.find((p) => p.type === type);
      if (!pill || ['kind', 'target', 'agg', 'metric'].includes(pill.type)) return;
      event.preventDefault();
      event.stopPropagation();
      removeClause(pill);
    }
  };

  const optionCount =
    active.kind === 'value'
      ? values.filteredItems.length + Number(values.canCommitTyped)
      : active.kind === 'add-filter'
        ? flatAddable.length
        : 0;

  return {
    effectiveSurface,
    expandedByDefault,
    isScopeOpen,
    resolved,
    guided,
    pills,
    zones,
    visiblePills,
    ignoredClauses,
    active,
    activeClause,
    activeZone,
    caretClauseId,
    caretZone,
    customEditor,
    values,
    preferredItems,
    addableGroups,
    flatAddable,
    astWindow,
    draftWindow,
    search,
    setSearch,
    highlight,
    setHighlight,
    error,
    setError,
    undo,
    setUndo,
    pivot,
    setPivot,
    cursorStage,
    setCursorStage,
    stages,
    listId,
    optionCount,
    rootRef,
    pickerRef,
    scopeToggleRef,
    openScope,
    closeScope,
    closeInspector,
    openEditor,
    openAddFilter,
    openField,
    handleCursorClauseChange,
    activateWqlSlot,
    moveEditor,
    updateClause,
    removeClause,
    removeAllIgnored,
    chooseValue,
    commit,
    submit,
    handleKeys,
    handlePillRailKeyDown,
  };
}
