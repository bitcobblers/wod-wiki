/**
 * WqlQueryInspectorModal — Sheet/dialog host over `<QueryObjectBuilder density="inline" />`.
 *
 * Accepts either a 1-line WQL shorthand (`:session{result:<id>}`) or a YAML
 * `QueryBlockObject` body, edits it through `<QueryObjectBuilder density="inline" />`,
 * and serializes back via `serializeQueryBlock(draftObj)` — keeping untouched
 * 1-line table queries minimal while upgrading customized views/titles/columns
 * cleanly into 2-space YAML.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  isYamlQueryBlockBody,
  parseDocument,
  parseQuery,
  parseQueryBlock,
  queryBlockToDocumentText,
  serializeQueryBlock,
  type QueryBlockObject,
} from '@bitcobblers/wod-wiki-wql';
import { EditorDialog } from '../dialog/EditorDialog';
import {
  QueryObjectBuilder,
  type QueryObjectValidationState,
} from '../composer';
import type { QueryExecutor } from '../contracts/query';

export interface WqlQueryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery: string;
  initialWidgetType?: string;
  initialAttributes?: Record<string, string>;
  /** Persist the applied query block body (1-line WQL or YAML). */
  onApply: (newQuery: string) => void | Promise<void>;
  title?: string;
  subtitle?: string;
  /** Label for the confirm button (defaults to "Apply to Block"). */
  applyLabel?: string;
  executor?: QueryExecutor;
}

function hydrateInitialObject(
  initialQuery: string,
  initialWidgetType?: string,
  initialAttributes?: Record<string, string>,
): QueryBlockObject {
  const hasAttrs = Boolean(initialAttributes && Object.keys(initialAttributes).length > 0);
  if (!isYamlQueryBlockBody(initialQuery) && !initialWidgetType && !hasAttrs && !initialQuery.trim().includes('\n')) {
    return { view: 'table', query: initialQuery.trim() };
  }
  const fenceTag = initialWidgetType ? `query:${initialWidgetType}` : undefined;
  const parsed = parseQueryBlock(initialQuery, { fenceTag });
  if (hasAttrs && initialAttributes) {
    return {
      ...parsed,
      attributes: { ...(parsed.attributes ?? {}), ...initialAttributes },
    };
  }
  return parsed;
}

function isObjectValid(obj: QueryBlockObject): boolean {
  if (obj.error) return false;
  const docText = queryBlockToDocumentText(obj).trim();
  if (!docText) return false;
  const doc = parseDocument(docText);
  if (!doc.doc.degenerate && doc.doc.assignments.length > 0) {
    return doc.diagnostics.length === 0;
  }
  return !parseQuery(docText).error;
}

export function WqlQueryInspectorModal({
  isOpen,
  onClose,
  initialQuery,
  initialWidgetType,
  initialAttributes,
  onApply,
  title = 'Edit Query Block',
  subtitle = 'Configure data query and presentation options.',
  applyLabel = 'Apply to Block',
  executor,
}: WqlQueryInspectorModalProps) {
  const [draftObj, setDraftObj] = useState<QueryBlockObject>(() =>
    hydrateInitialObject(initialQuery, initialWidgetType, initialAttributes),
  );
  const [validation, setValidation] = useState<QueryObjectValidationState>(() => ({
    valid: isObjectValid(hydrateInitialObject(initialQuery, initialWidgetType, initialAttributes)),
  }));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const next = hydrateInitialObject(initialQuery, initialWidgetType, initialAttributes);
      setDraftObj(next);
      setValidation({ valid: isObjectValid(next) });
      setError(null);
    }
  }, [isOpen, initialQuery, initialWidgetType, initialAttributes]);

  const serializedDraft = useMemo(() => serializeQueryBlock(draftObj), [draftObj]);

  const handleApply = async () => {
    if (applying || !isObjectValid(draftObj)) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(serializeQueryBlock(draftObj));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <EditorDialog
      open={isOpen}
      onClose={onClose}
      presentation="sheet"
      title={title}
      description={subtitle}
      footer={
        <>
          <div
            className="flex-1 min-w-0 truncate font-mono text-xs text-muted-foreground"
            data-testid="wql-inspector-draft"
          >
            {serializedDraft}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="wql-inspector-apply"
            onClick={() => void handleApply()}
            disabled={!validation.valid || applying}
            className="min-h-12 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow transition-colors"
          >
            {applying ? 'Applying…' : applyLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <QueryObjectBuilder
          density="inline"
          value={draftObj}
          onChange={setDraftObj}
          onValidationChange={setValidation}
          executor={executor}
        />
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono"
          >
            {error}
          </p>
        )}
      </div>
    </EditorDialog>
  );
}
