/**
 * WidgetComposerDialog — Dialog host over `<QueryObjectBuilder density="studio" />`.
 *
 * Shared by:
 *  - Explorer Save → "Add to dashboard" (`QueryToDashboardDialog`)
 *  - Dashboard page "Add widget" & "Edit widget"
 *  - Prebuilt "Inspect" (read-only)
 *  - Note / Effort / Equipment detail page "Add widget"
 */
import { useState, type ReactNode } from 'react';
import {
  EditorDialog,
  QueryObjectBuilder,
  type QueryExecutor,
  type QueryObjectValidationState,
} from '@bitcobblers/wod-wiki-ui';
import {
  parseDocument,
  parseQuery,
  parseQueryBlock,
  queryBlockAttributes,
  queryBlockToDocumentText,
  widgetFenceTag,
  type QueryBlockObject,
} from '@bitcobblers/wod-wiki-wql';

export interface WidgetComposerApply {
  title?: string;
  question?: string;
  type: string;
  spanCols?: number;
  spanFull?: boolean;
  wql: string;
  queryObject?: QueryBlockObject;
  attributes?: Record<string, string>;
}

export interface WidgetComposerDialogProps {
  open: boolean;
  onClose: () => void;
  /** add = blank widget; edit = seeded from a widget; inspect = read-only. */
  mode: 'add' | 'edit' | 'inspect';
  /** Seed WQL / Query Document / YAML for the calculation composer. */
  initialWql: string;
  /** Optional pre-parsed structured `QueryBlockObject` (preferred when editing an existing widget). */
  initialObject?: QueryBlockObject;
  /** Seed display fields (edit/inspect of an existing widget). */
  initial?: {
    title?: string;
    question?: string;
    type?: string;
    spanCols?: number;
    spanFull?: boolean;
    attributes?: Record<string, string>;
  };
  /** Read-only dataset subset step (Explorer -> Dashboard). */
  subsetQuery?: string | null;
  /** Optional destination step (choose/create dashboard). */
  destination?: ReactNode;
  executor?: QueryExecutor;
  rangeStart?: number;
  rangeEnd?: number;
  preferredUnit?: string;
  tokenValues?: Record<string, string>;
  onApply?: (spec: WidgetComposerApply) => void | Promise<void>;
  footerExtra?: ReactNode;
  applyLabel?: string;
}

function buildSeedObject(
  initialWql: string,
  initialObject?: QueryBlockObject,
  initial?: WidgetComposerDialogProps['initial'],
): QueryBlockObject {
  if (initialObject) {
    return {
      ...initialObject,
      title: initial?.title ?? initialObject.title,
      description: initial?.question ?? initialObject.description,
    };
  }
  const fenceTag = widgetFenceTag({
    type: initial?.type ?? '',
    spanCols: initial?.spanCols,
    spanFull: initial?.spanFull,
    attributes: initial?.attributes,
  }).slice(3);
  return parseQueryBlock(initialWql, {
    fenceTag,
    adjacentTitle: initial?.title?.trim() || undefined,
    adjacentDescription: initial?.question?.trim() || undefined,
  });
}

function isSeedValid(obj: QueryBlockObject): boolean {
  if (obj.error) return false;
  const compiled = queryBlockToDocumentText(obj).trim();
  if (!compiled) return false;
  const doc = parseDocument(compiled);
  if (!doc.doc.degenerate && doc.doc.assignments.length > 0) {
    return doc.diagnostics.length === 0;
  }
  return !parseQuery(compiled).error;
}

export function WidgetComposerDialog({ open, ...props }: WidgetComposerDialogProps) {
  if (!open) return null;
  return <ComposerSession {...props} />;
}

function ComposerSession({
  onClose,
  mode,
  initialWql,
  initialObject,
  initial,
  subsetQuery,
  destination,
  executor,
  rangeStart,
  rangeEnd,
  preferredUnit,
  tokenValues,
  onApply,
  footerExtra,
  applyLabel = mode === 'edit' ? 'Apply changes' : 'Add widget',
}: Omit<WidgetComposerDialogProps, 'open'>) {
  const readOnly = mode === 'inspect';
  const [draftObj, setDraftObj] = useState<QueryBlockObject>(() =>
    buildSeedObject(initialWql, initialObject, initial),
  );
  const [validation, setValidation] = useState<QueryObjectValidationState>(() => {
    const seed = buildSeedObject(initialWql, initialObject, initial);
    return { valid: isSeedValid(seed), error: seed.error };
  });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (!validation.valid || !onApply || applying) return;
    const compiled = queryBlockToDocumentText(draftObj).trim();
    if (!compiled || !isSeedValid(draftObj)) return;

    setApplying(true);
    setError(null);
    try {
      const derivedAttrs = queryBlockAttributes(draftObj).attributes;
      await onApply({
        title: draftObj.title?.trim() || undefined,
        question: draftObj.description?.trim() || undefined,
        type: draftObj.view === 'table' && !draftObj.rawViewType ? '' : draftObj.rawViewType ?? draftObj.view,
        spanCols: typeof draftObj.span === 'number' ? draftObj.span : undefined,
        spanFull: draftObj.span === 'full' ? true : undefined,
        wql: compiled,
        queryObject: draftObj,
        attributes: Object.keys(derivedAttrs).length > 0 ? derivedAttrs : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <EditorDialog
      open
      onClose={onClose}
      presentation="sheet"
      title={mode === 'inspect' ? 'Inspect widget' : mode === 'edit' ? 'Edit widget' : 'Add widget'}
      description={
        readOnly
          ? 'Read-only — clone the dashboard to edit this widget.'
          : 'Dataset, calculation, visualization, preview — then apply.'
      }
      footer={
        readOnly && !footerExtra ? undefined : (
          <>
            {footerExtra}
            <div className="flex-1" />
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-12 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="widget-composer-apply"
                  disabled={!validation.valid || applying}
                  title={validation.error}
                  onClick={() => void handleApply()}
                  className="min-h-12 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow transition-colors"
                >
                  {applying ? 'Applying…' : applyLabel}
                </button>
              </>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <QueryObjectBuilder
          density="studio"
          value={draftObj}
          onChange={setDraftObj}
          readOnly={readOnly}
          subsetQuery={subsetQuery}
          destination={destination}
          executor={executor}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          preferredUnit={preferredUnit}
          tokenValues={tokenValues}
          onValidationChange={setValidation}
        />

        {error && (
          <p
            role="alert"
            data-testid="widget-composer-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono"
          >
            {error}
          </p>
        )}
      </div>
    </EditorDialog>
  );
}
