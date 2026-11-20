import type { KeyboardEvent, RefObject } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { ClauseIcon } from './ClauseIcon';
import { InlineClauseEditor } from './InlineClauseEditor';
import { TokenSlotPill } from './QueryPalette';
import type { ClauseItemsResult } from './clauseItems';
import type { CustomSlotDefinition } from './ComposerRegistry';
import { getClauseMeta, type QueryClause } from './queryClauses';
import type {
  AddableFilterGroup,
  EnrichedQueryClause,
  QueryZone,
  ScopeZoneModel,
} from './queryZones';
import type { ActiveEditor } from './useWqlComposerController';

export interface WqlScopeMapProps {
  surface?: 'popover' | 'inline' | 'sheet';
  zones: ScopeZoneModel[];
  visiblePills: EnrichedQueryClause[];
  ignoredClauses: EnrichedQueryClause[];
  active: ActiveEditor;
  activeZone?: QueryZone;
  caretClauseId: string | null;
  caretZone?: QueryZone;
  listId: string;
  search: string;
  onSearchChange: (value: string) => void;
  highlight: number;
  onHighlight: (idx: number) => void;
  pickerRef: RefObject<HTMLInputElement | null>;
  values: ClauseItemsResult;
  preferredItems: { value: string; label: string }[];
  customEditor?: CustomSlotDefinition;
  addableGroups: AddableFilterGroup[];
  astWindow?: { kind: string; start?: string; end?: string };
  draftWindow: () => { kind: string; start?: string; end?: string } | undefined;
  onOpenClause: (clause: QueryClause) => void;
  onRemoveClause: (clause: QueryClause) => void;
  onRemoveAllIgnored: () => void;
  onOpenAddFilter: () => void;
  onOpenField: (type: string) => void;
  onUpdateClause: (clause: QueryClause, value: string | null) => void;
  onChooseValue: (value: string) => void;
  onMoveEditor: (dir: -1 | 1) => boolean;
  onCloseInspector: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPillRailKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onError: (msg: string | undefined) => void;
}

const STRUCTURAL_HEAD_TYPES = new Set(['kind', 'target', 'agg', 'metric']);

/** Concept B 4-zone grammar map (WHAT / WHERE / WHEN / GROUP) paired with a docked Clause Inspector. */
export function WqlScopeMap({
  surface = 'inline',
  zones,
  visiblePills,
  ignoredClauses,
  active,
  activeZone,
  caretClauseId,
  caretZone,
  listId,
  search,
  onSearchChange,
  highlight,
  onHighlight,
  pickerRef,
  values,
  preferredItems,
  customEditor,
  addableGroups,
  astWindow,
  draftWindow,
  onOpenClause,
  onRemoveClause,
  onRemoveAllIgnored,
  onOpenAddFilter,
  onOpenField,
  onUpdateClause,
  onChooseValue,
  onMoveEditor,
  onCloseInspector,
  onKeyDown,
  onPillRailKeyDown,
  onError,
}: WqlScopeMapProps) {
  const activeClause = active.kind === 'value' ? active.clause : undefined;
  const activePillIndex = activeClause ? visiblePills.findIndex((p) => p.id === activeClause.id) : -1;
  const activeMeta = activeClause ? getClauseMeta(activeClause.type) : undefined;
  let flatCatalogIdx = 0;

  return (
    <div className="min-w-0 divide-y divide-border/70" data-testid="wql-scope-map">
      {/* 4-Zone Grammar Track: 2×2 in header popovers & sheets so pills never clip; 4-across on wide inline workbenches */}
      <div
        className={cn(
          'grid grid-cols-1 gap-2 bg-muted/25 p-2.5 sm:grid-cols-2',
          surface === 'inline' && 'xl:grid-cols-4',
        )}
        onKeyDown={onPillRailKeyDown}
      >
        {zones.map((zone) => {
          const isZoneActive = activeZone === zone.zone;
          const isZoneCaret = !isZoneActive && caretZone === zone.zone;
          return (
            <div
              key={zone.zone}
              data-testid={`wql-zone-${zone.zone}`}
              className={cn(
                'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-2 transition-colors',
                isZoneActive
                  ? 'border-primary bg-primary/5'
                  : isZoneCaret
                    ? 'border-primary/70 bg-primary/10'
                    : 'border-border/80',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className={cn('font-bold tracking-wider', isZoneActive || isZoneCaret ? 'text-primary' : 'text-muted-foreground')}>
                  {zone.label}
                </span>
                <span className="truncate text-muted-foreground">{zone.hint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {zone.clauses.map((clause) => {
                  const isAct = activeClause?.id === clause.id;
                  const isCaret = caretClauseId === clause.id;
                  const isHead = STRUCTURAL_HEAD_TYPES.has(clause.type);
                  return (
                    <TokenSlotPill
                      key={clause.id}
                      clause={clause}
                      isActive={isAct}
                      isCaretMatch={isCaret}
                      invalid={clause.invalid}
                      invalidReason={clause.invalidReason}
                      onClick={() => onOpenClause(clause)}
                      onRemove={isHead ? undefined : () => onRemoveClause(clause)}
                    />
                  );
                })}

                {zone.implicitSlots.map((slot) => (
                  <button
                    key={slot.type}
                    type="button"
                    data-testid={`wql-implicit-${slot.type}`}
                    onClick={() => onOpenField(slot.type)}
                    className="inline-flex min-h-11 sm:min-h-7 items-center gap-1.5 rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ClauseIcon type={slot.type} />
                    <span>{slot.placeholder}</span>
                  </button>
                ))}

                {zone.zone === 'where' && (
                  <button
                    type="button"
                    data-testid="wql-add-filter-btn"
                    aria-pressed={active.kind === 'add-filter'}
                    onClick={onOpenAddFilter}
                    className={cn(
                      'inline-flex min-h-11 sm:min-h-7 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active.kind === 'add-filter'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-dashed border-primary/60 bg-background text-primary hover:border-solid hover:bg-primary/10',
                    )}
                  >
                    <Plus aria-hidden="true" className="size-3" />
                    <span>Filter</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ignored Filter Recovery Strip */}
      {ignoredClauses.length > 0 && (
        <div
          role="status"
          data-testid="wql-ignored-strip"
          className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              {ignoredClauses.length} filter{ignoredClauses.length > 1 ? 's' : ''} ignored on this target (
              {ignoredClauses.map((c) => c.type).join(', ')}).
            </span>
          </span>
          <button
            type="button"
            data-testid="wql-remove-ignored"
            onClick={onRemoveAllIgnored}
            className="inline-flex min-h-11 sm:min-h-7 items-center rounded-md border border-amber-600/40 bg-background px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            Remove ignored ({ignoredClauses.length})
          </button>
        </div>
      )}

      {/* Docked Clause Inspector OR Categorized + Filter Catalog */}
      {active.kind === 'add-filter' && (
        <div
          data-testid="wql-filter-typeahead"
          className="bg-card p-3 space-y-2.5"
          onKeyDown={onKeyDown}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <span>Add filter clause</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                  Catalog
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Pick a clause type before choosing a value.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close filter catalog"
              onClick={onCloseInspector}
              className="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <input
            ref={pickerRef}
            type="search"
            role="combobox"
            aria-label="Search filter catalog"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={highlight >= 0 ? `${listId}-option-${highlight}` : undefined}
            value={search}
            placeholder="Search filters (tag, movement, notebook, date…)"
            onChange={(e) => {
              onSearchChange(e.target.value);
              onHighlight(-1);
            }}
            data-testid="wql-picker-search"
            className="min-h-11 sm:min-h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm sm:text-xs text-foreground placeholder:text-[hsl(var(--field-placeholder))] focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div id={listId} role="listbox" aria-label="Filter types" className="max-h-60 overflow-y-auto space-y-2.5">
            {addableGroups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground italic">No matching filter types.</p>
            ) : (
              addableGroups.map((group) => (
                <div key={group.group} className="space-y-1">
                  <div className="px-1.5 text-[11px] font-semibold text-muted-foreground">{group.group}</div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const idx = flatCatalogIdx++;
                      const isHi = idx === highlight;
                      return (
                        <button
                          key={item.type}
                          id={`${listId}-option-${idx}`}
                          type="button"
                          role="option"
                          aria-selected={false}
                          data-testid={`wql-filter-typeahead-${item.type}`}
                          onMouseEnter={() => onHighlight(idx)}
                          onClick={() => onOpenField(item.type)}
                          className={cn(
                            'flex min-h-11 sm:min-h-9 items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors',
                            isHi ? 'bg-primary/10 border-primary/40 text-foreground' : 'hover:bg-muted/70',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ClauseIcon type={item.type} className="size-3.5 text-primary" />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold text-foreground">{item.label}</span>
                              {item.description && (
                                <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.prefix}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {active.kind === 'value' && activeClause && activeMeta && (
        <div
          data-testid="wql-field-picker"
          className="bg-card p-3 space-y-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              onKeyDown(e);
            }
          }}
        >
          {/* Row 1: Field icon + name + Step X of Y + description + prev/next/close */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold text-xs text-foreground">
                  <ClauseIcon type={activeClause.type} className="size-3.5 text-primary" />
                  <span>{activeMeta.label}</span>
                </span>
                {activePillIndex >= 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary tabular-nums">
                    {activePillIndex + 1} of {visiblePills.length}
                  </span>
                )}
              </div>
              {activeMeta.description && (
                <p className="text-xs text-muted-foreground">{activeMeta.description}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Previous WQL segment"
                data-testid="wql-segment-previous"
                disabled={activePillIndex <= 0}
                onClick={() => {
                  if (onMoveEditor(-1)) pickerRef.current?.focus();
                }}
                className="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next WQL segment"
                data-testid="wql-segment-next"
                disabled={activePillIndex < 0 || activePillIndex >= visiblePills.length - 1}
                onClick={() => {
                  if (onMoveEditor(1)) pickerRef.current?.focus();
                }}
                className="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Close segment editor"
                onClick={onCloseInspector}
                className="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>

          {/* Row 2: Full-width combobox search + optional filter modifiers */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only">Search {activeMeta.label}</label>
            <input
              ref={pickerRef}
              type="search"
              role="combobox"
              aria-label={`Search ${activeMeta.label}`}
              aria-controls={listId}
              aria-expanded="true"
              aria-activedescendant={highlight >= 0 ? `${listId}-option-${highlight}` : undefined}
              value={search}
              placeholder={activeClause.value ? `Current: ${activeClause.value}` : `Type value for ${activeMeta.label}…`}
              onChange={(e) => {
                onSearchChange(e.target.value);
                onHighlight(-1);
                onError(undefined);
              }}
              onKeyDown={onKeyDown}
              className="min-h-11 sm:min-h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-sm sm:text-xs text-foreground placeholder:text-[hsl(var(--field-placeholder))] focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="wql-picker-search"
            />
            {activeClause.filterIndex !== undefined && (
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="inline-flex min-h-11 sm:min-h-7 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={activeClause.negate ?? false}
                    onChange={(e) => onUpdateClause({ ...activeClause, negate: e.target.checked }, activeClause.value)}
                    className="size-4 sm:size-3.5 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Exclude</span>
                </label>
                <label className="inline-flex min-h-11 sm:min-h-7 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={activeClause.value.split('|').every((value) => value.endsWith('*'))}
                    onChange={(e) =>
                      onUpdateClause(
                        activeClause,
                        activeClause.value
                          .split('|')
                          .map((value) => `${value.replace(/\*$/, '')}${e.target.checked ? '*' : ''}`)
                          .join('|'),
                      )
                    }
                    className="size-4 sm:size-3.5 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Starts with</span>
                </label>
              </div>
            )}
          </div>

          {activeClause.type === 'time' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-0.5 text-xs">
              <label className="block text-foreground font-medium">
                Start date
                <input
                  type="date"
                  aria-label="Start date"
                  className="mt-1 min-h-11 sm:min-h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                  onChange={(e) => {
                    const end = draftWindow();
                    onUpdateClause(activeClause, `from ${e.target.value}${end?.kind === 'range' && end.end ? ` to ${end.end}` : ''}`);
                  }}
                  value={astWindow?.kind === 'range' ? (astWindow.start ?? '') : ''}
                />
              </label>
              <label className="block text-foreground font-medium">
                End date
                <input
                  type="date"
                  aria-label="End date"
                  className="mt-1 min-h-11 sm:min-h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                  onChange={(e) => {
                    const win = draftWindow();
                    if (win?.kind === 'range' && win.start) {
                      if (e.target.value && e.target.value < win.start) {
                        onError('End date must be on or after Start date');
                        return;
                      }
                      onUpdateClause(activeClause, `from ${win.start}${e.target.value ? ` to ${e.target.value}` : ''}`);
                    } else {
                      onError('Choose a start date first');
                    }
                  }}
                  value={astWindow?.kind === 'range' ? (astWindow.end ?? '') : ''}
                />
              </label>
            </div>
          )}

          {customEditor ? (
            <customEditor.Editor
              value={customEditor.parseValue ? customEditor.parseValue(activeClause.value) : activeClause.value}
              onChange={(value) =>
                onUpdateClause(activeClause, customEditor.formatValue ? customEditor.formatValue(value) : String(value))
              }
              onClose={onCloseInspector}
            />
          ) : (
            <InlineClauseEditor
              clause={activeClause}
              filteredItems={preferredItems}
              selectedValues={values.selectedValues}
              isMulti={values.isMulti}
              typedValue={values.typedValue}
              canCommitTyped={values.canCommitTyped}
              emptyText={values.emptyText}
              highlightIdx={highlight}
              onHighlight={onHighlight}
              onCommitValue={onChooseValue}
              onCommitTyped={onChooseValue}
              listId={listId}
              onDone={onCloseInspector}
              onReorder={(dimensions) => onUpdateClause(activeClause, dimensions.join('|'))}
            />
          )}
        </div>
      )}
    </div>
  );
}
