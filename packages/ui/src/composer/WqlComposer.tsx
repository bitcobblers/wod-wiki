import { type ReactNode } from 'react';
import { Code2, Plus } from 'lucide-react';
import { isPipelineQuery, type AnyParsedQuery } from '@bitcobblers/wod-wiki-wql';
import { cn } from '../utils/cn';
import { TokenSlotPill } from './QueryPalette';
import { resolveQueryDraft } from './queryAst';
import type { ClauseType } from './queryClauses';
import {
  useWqlComposerController,
  type WqlSegmentEditRequest,
  type WqlValidationState,
} from './useWqlComposerController';
import { WqlDiagnosticsStrip } from './WqlDiagnosticsStrip';
import { WqlScopeMap } from './WqlScopeMap';
import { WqlTextEditor } from './WqlTextEditor';
import type { WqlExecutor, WqlStageCounts } from './useWqlStageCounts';

export type { WqlValidationState, WqlSegmentEditRequest };

export interface WqlComposerProps {
  initialQuery?: string;
  query?: string;
  /** Synchronous resolved draft, including invalid exact text. Execution debounce belongs to the host. */
  onQueryChange?: (wql: string) => void;
  onValidationChange?: (state: WqlValidationState) => void;
  onAstChange?: (ast: AnyParsedQuery) => void;
  /** Explicit actions receive the current valid draft on the first activation. */
  onSubmit?: (wql: string) => void;
  actionLabel?: string;
  compact?: boolean;
  defaultExpanded?: boolean;
  surface?: 'popover' | 'inline' | 'sheet';
  showDiagnostics?: boolean;
  diagnosticsPosition?: 'top' | 'bottom';
  execute?: WqlExecutor;
  /** Reuse host execution counts instead of running another query. */
  stages?: WqlStageCounts;
  debounceMs?: number;
  customSlots?: ReactNode;
  diagnosticsActions?: ReactNode;
  hiddenClauseTypes?: ClauseType[];
  /** Priority only; valid choices are never excluded by favorites. */
  preferredChoices?: readonly string[];
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  /** External commands activate the same writer as pointer and keyboard entry. */
  segmentEditRequest?: WqlSegmentEditRequest;
  /** Hide the zone Scope Map below `lg` while keeping the single text editor interactive (e.g. mobile palette Results view). */
  hideScopeMap?: boolean;
  onScopeOpenChange?: (open: boolean) => void;
}

/**
 * WqlComposer — unified Split-Pill header rail + in-place single WqlTextEditor
 * and WHAT/WHERE/WHEN/GROUP Scope Map.
 */
export function WqlComposer({
  initialQuery,
  query,
  onQueryChange,
  onValidationChange,
  onAstChange,
  onSubmit,
  actionLabel,
  compact = false,
  defaultExpanded,
  surface,
  showDiagnostics = true,
  diagnosticsPosition = 'bottom',
  execute,
  stages: suppliedStages,
  debounceMs,
  customSlots,
  diagnosticsActions,
  hiddenClauseTypes,
  preferredChoices,
  autoFocus = false,
  placeholder = 'Search text or enter WQL',
  className,
  segmentEditRequest,
  hideScopeMap = false,
  onScopeOpenChange,
}: WqlComposerProps) {
  const ctrl = useWqlComposerController({
    initialQuery,
    query,
    onQueryChange,
    onValidationChange,
    onAstChange,
    onSubmit,
    compact,
    defaultExpanded,
    surface,
    execute,
    stages: suppliedStages,
    debounceMs,
    hiddenClauseTypes,
    preferredChoices,
    segmentEditRequest,
    onScopeOpenChange,
  });

  const action = (
    <>
      {actionLabel && (
        <button
          type="button"
          onClick={ctrl.submit}
          disabled={!ctrl.resolved.valid || Boolean(ctrl.error) || Boolean(ctrl.pivot)}
          className="min-h-11 sm:min-h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
      {diagnosticsActions}
    </>
  );

  const diagnostics = {
    ...ctrl.resolved,
    valid: ctrl.resolved.valid && !ctrl.error,
    error: ctrl.error ?? ctrl.resolved.error,
  };

  const showInlineAlert =
    !showDiagnostics &&
    Boolean(
      ctrl.error ??
        (ctrl.resolved.wql.trim() && /[:{}|@]/.test(ctrl.resolved.wql) ? ctrl.resolved.error : undefined),
    );

  const scopeMapNode = ctrl.guided && (
    <div data-testid="wql-composer">
      <WqlScopeMap
        surface={ctrl.effectiveSurface}
        zones={ctrl.zones}
        visiblePills={ctrl.visiblePills}
        ignoredClauses={ctrl.ignoredClauses}
        active={ctrl.active}
        activeZone={ctrl.activeZone}
        caretClauseId={ctrl.caretClauseId}
        caretZone={ctrl.caretZone}
        listId={ctrl.listId}
        search={ctrl.search}
        onSearchChange={ctrl.setSearch}
        highlight={ctrl.highlight}
        onHighlight={ctrl.setHighlight}
        pickerRef={ctrl.pickerRef}
        values={ctrl.values}
        preferredItems={ctrl.preferredItems}
        customEditor={ctrl.customEditor}
        addableGroups={ctrl.addableGroups}
        astWindow={ctrl.astWindow}
        draftWindow={ctrl.draftWindow}
        onOpenClause={(clause) => ctrl.openEditor(clause)}
        onRemoveClause={ctrl.removeClause}
        onRemoveAllIgnored={ctrl.removeAllIgnored}
        onOpenAddFilter={() => ctrl.openAddFilter()}
        onOpenField={(type) => ctrl.openField(type)}
        onUpdateClause={ctrl.updateClause}
        onChooseValue={ctrl.chooseValue}
        onMoveEditor={ctrl.moveEditor}
        onCloseInspector={() => ctrl.closeInspector(true)}
        onKeyDown={ctrl.handleKeys}
        onPillRailKeyDown={ctrl.handlePillRailKeyDown}
        onError={ctrl.setError}
      />
    </div>
  );

  return (
    <div
      ref={ctrl.rootRef}
      className={cn('relative min-w-0', !compact && 'space-y-2', className)}
      data-testid="wql-composer-root"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && ctrl.isScopeOpen && !ctrl.expandedByDefault) {
          event.preventDefault();
          event.stopPropagation();
          ctrl.closeScope(true);
        }
      }}
    >
      {diagnosticsPosition === 'top' && showDiagnostics && (
        <WqlDiagnosticsStrip
          diagnostics={diagnostics}
          stages={ctrl.stages}
          activeStage={ctrl.cursorStage}
          actions={action}
          variant="header"
          hideSummary={ctrl.guided}
        />
      )}

      {/* Single top bar: Split-Pills at rest <-> Single live WqlTextEditor when open */}
      {!ctrl.isScopeOpen ? (
        <div
          data-testid="wql-composer"
          onKeyDown={ctrl.handlePillRailKeyDown}
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1 shadow-xs',
            !compact && 'p-2',
          )}
        >
          {ctrl.visiblePills
            .filter((pill) => !['time', 'groupby'].includes(pill.type) || Boolean(pill.value))
            .map((pill) => (
            <TokenSlotPill
              key={pill.id}
              clause={pill}
              compact={compact}
              invalid={pill.invalid}
              invalidReason={pill.invalidReason}
              onClick={() => ctrl.openEditor(pill, undefined, true)}
              onRemove={
                ['kind', 'target', 'agg', 'metric'].includes(pill.type)
                  ? undefined
                  : () => ctrl.removeClause(pill)
              }
            />
          ))}
          <button
            type="button"
            data-testid="wql-add-filter-btn"
            onClick={() => ctrl.openAddFilter(true)}
            className="inline-flex min-h-11 sm:min-h-7 items-center gap-1 rounded-full border border-dashed border-primary/60 bg-background px-2.5 py-0.5 text-xs font-semibold text-primary transition-colors hover:border-solid hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus aria-hidden="true" className="size-3" />
            <span>Filter</span>
          </button>
          {customSlots}
          {ctrl.undo && (
            <button
              type="button"
              onClick={() => {
                ctrl.commit(resolveQueryDraft(ctrl.undo!));
                ctrl.setUndo(undefined);
              }}
              className="min-h-11 sm:min-h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Undo removal
            </button>
          )}
          <button
            type="button"
            ref={ctrl.scopeToggleRef}
            data-testid="wql-scope-toggle"
            aria-expanded="false"
            aria-label="Edit WQL and Scope Map"
            title="Edit WQL & Scope Map"
            onClick={() => ctrl.openScope(true)}
            className="ml-auto inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center rounded-md border border-border/80 bg-background px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Code2 aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : (
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-xl border bg-card transition-shadow',
            compact ? 'border-primary/60 px-1.5 py-0.5 shadow-xs ring-2 ring-ring/20' : 'border-border px-1.5 py-1 shadow-xs focus-within:ring-2 focus-within:ring-ring',
          )}
        >
          <div className="min-w-0 flex-1">
            <WqlTextEditor
              value={ctrl.resolved.wql}
              placeholder={placeholder}
              dense={compact}
              className="min-w-0 w-full bg-transparent"
              activeRange={
                ctrl.active.kind === 'value'
                  ? ctrl.active.range
                  : isPipelineQuery(ctrl.resolved.ast) && ctrl.cursorStage
                    ? { from: ctrl.cursorStage.from, to: ctrl.cursorStage.to }
                    : undefined
              }
              activeClause={ctrl.activeClause}
              onSlotActivate={ctrl.activateWqlSlot}
              onCursorClauseChange={ctrl.handleCursorClauseChange}
              onCursorStageChange={ctrl.setCursorStage}
              onChange={(text) => ctrl.commit(resolveQueryDraft(text))}
              onSubmit={ctrl.submit}
              onEscape={() => {
                if (ctrl.active.kind === 'value' || ctrl.active.kind === 'add-filter') {
                  ctrl.closeInspector(true);
                  return true;
                }
                if (!ctrl.expandedByDefault) {
                  ctrl.closeScope(true);
                  return true;
                }
                return false;
              }}
              autoFocus={autoFocus}
            />
          </div>
          {ctrl.undo && (
            <button
              type="button"
              onClick={() => {
                ctrl.commit(resolveQueryDraft(ctrl.undo!));
                ctrl.setUndo(undefined);
              }}
              className="min-h-11 sm:min-h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Undo removal
            </button>
          )}
          {customSlots}
          {!ctrl.expandedByDefault && ctrl.guided && (
            <button
              type="button"
              data-testid="wql-scope-close"
              aria-expanded="true"
              onClick={() => ctrl.closeScope(true)}
              className="min-h-11 sm:min-h-7 shrink-0 rounded-md border border-border bg-muted/60 px-2.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Done
            </button>
          )}
        </div>
      )}

      {/* Scope Map: Floating Popover on compact headers, inline/sheet otherwise */}
      {ctrl.isScopeOpen && ctrl.guided && (
        ctrl.effectiveSurface === 'popover' ? (
          <div
            role="region"
            aria-label="WQL Scope Map"
            className={cn(
              'absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-border bg-card shadow-lg',
              hideScopeMap && 'hidden',
            )}
          >
            {scopeMapNode}
          </div>
        ) : (
          <div className={cn('overflow-hidden rounded-xl border border-border bg-card', hideScopeMap && 'hidden')}>
            {scopeMapNode}
          </div>
        )
      )}

      {ctrl.pivot && (
        <div role="alertdialog" aria-label="Confirm query pivot" className="rounded-xl border border-border bg-card p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Changing the query removes incompatible clauses:</p>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {ctrl.pivot.removed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button type="button" className="min-h-11 sm:min-h-8 rounded-md border border-border px-3 text-xs font-medium" onClick={() => ctrl.setPivot(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              className="min-h-11 sm:min-h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
              onClick={() => {
                ctrl.commit(ctrl.pivot!.draft);
                ctrl.setPivot(undefined);
                ctrl.closeInspector(true);
              }}
            >
              Change query
            </button>
          </div>
        </div>
      )}

      {showInlineAlert && (
        <p role="alert" className="text-sm text-destructive">
          {ctrl.error ?? ctrl.resolved.error}
        </p>
      )}

      {showDiagnostics && diagnosticsPosition === 'bottom' ? (
        <WqlDiagnosticsStrip
          diagnostics={diagnostics}
          stages={ctrl.stages}
          activeStage={ctrl.cursorStage}
          actions={action}
          hideSummary={ctrl.guided}
        />
      ) : (
        (diagnosticsPosition !== 'top' || !showDiagnostics) &&
        Boolean(actionLabel || diagnosticsActions) && (
          <div className="flex flex-wrap items-center justify-end gap-2">{action}</div>
        )
      )}
    </div>
  );
}
