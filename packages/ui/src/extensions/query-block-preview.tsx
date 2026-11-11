import { Decoration, WidgetType, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import React from "react";
// @ts-ignore
import { createRoot } from "react-dom/client";
import { sectionField, type EditorSection } from "./section-state";
import { setEditorFocused } from "./editor-focus";
import { resolveQueryExecutionScope } from "@bitcobblers/wod-wiki-wql";
import { QueryBlockView } from "../blocks/QueryBlockView";
import type { InlineMetricEditPayload } from "../widgets/OutputStatementsTable";
import type { QueryExecutor } from "../contracts/query";
import { patchBlockQuery } from "../utils/blockQueryPatcher";

type Root = { render: (c: React.ReactNode) => void; unmount: () => void };

export const setQuerySourceEditing = StateEffect.define<{
  sectionId: string;
  editing: boolean;
}>();

export const editingQuerySectionsField = StateField.define<ReadonlySet<string>>({
  create: () => new Set<string>(),
  update(prev, tr) {
    let next: Set<string> | null = null;
    for (const effect of tr.effects) {
      if (effect.is(setQuerySourceEditing)) {
        next ??= new Set(prev);
        if (effect.value.editing) {
          next.add(effect.value.sectionId);
        } else {
          next.delete(effect.value.sectionId);
        }
      }
      if (effect.is(setEditorFocused) && !effect.value && prev.size > 0) {
        return new Set<string>();
      }
    }

    const active = next ?? prev;
    if (active.size === 0) return active;

    const sectionChanged =
      tr.startState.field(sectionField, false) !== tr.state.field(sectionField, false);

    // Remap section IDs across sectionField refreshes and close when cursor leaves
    if (tr.selection || tr.docChanged || sectionChanged) {
      const prevSections = tr.startState.field(sectionField, false)?.sections ?? [];
      const { sections } = tr.state.field(sectionField);
      const cursor = tr.state.selection.main.head;
      const retained = new Set<string>();
      for (const id of active) {
        let sec = sections.find((s) => s.id === id && s.type === "query");
        if (!sec) {
          const prevSec = prevSections.find((s) => s.id === id && s.type === "query");
          if (prevSec) {
            const mappedFrom = tr.changes.mapPos(prevSec.from, 1);
            sec = sections.find((s) => s.type === "query" && s.from === mappedFrom);
          }
        }
        if (sec && cursor >= sec.from && cursor <= sec.to) {
          retained.add(sec.id);
        }
      }
      const unchanged =
        retained.size === active.size && [...retained].every((id) => active.has(id));
      if (!unchanged) return retained;
    }

    return active;
  },
});

export interface QueryBlockPreviewOptions {
  executor?: QueryExecutor;
  onResultSaved?: (callback: () => void) => (() => void) | void;
  readOnly?: boolean;
  onSaveQuery?: (sectionId: string, nextQuery: string) => void | Promise<void>;
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void>;
  onEditMetric?: (resultId: string, payload: InlineMetricEditPayload) => void | Promise<void>;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
  tokenValues?: Record<string, string>;
  noteId?: string;
}

class ReactQueryBlock extends WidgetType {
  private root: Root | null = null;
  private container: HTMLElement | null = null;

  constructor(
    readonly queryText: string,
    readonly sectionId: string,
    readonly sectionFrom: number,
    readonly widgetType?: string,
    readonly widgetError?: string,
    readonly attributes?: Record<string, string>,
    readonly tokenValues?: Record<string, string>,
    readonly options?: QueryBlockPreviewOptions,
  ) {
    super();
  }

  eq(other: ReactQueryBlock): boolean {
    return (
      this.queryText === other.queryText &&
      this.sectionId === other.sectionId &&
      this.sectionFrom === other.sectionFrom &&
      this.widgetType === other.widgetType &&
      this.widgetError === other.widgetError &&
      JSON.stringify(this.attributes ?? {}) === JSON.stringify(other.attributes ?? {}) &&
      JSON.stringify(this.tokenValues ?? {}) === JSON.stringify(other.tokenValues ?? {}) &&
      this.options?.readOnly === other.options?.readOnly &&
      this.options?.executor === other.options?.executor &&
      this.options?.onOpenNote === other.options?.onOpenNote &&
      this.options?.noteHref === other.options?.noteHref
    );
  }

  private resolveSection(view: EditorView): EditorSection | null {
    const byId = findQueryBlockSection(view, this.sectionId);
    if (byId) return byId;
    const { sections } = view.state.field(sectionField);
    if (this.container && view.dom.contains(this.container)) {
      try {
        const domPos = view.posAtDOM(this.container);
        const byDom = sections.find(
          (s) => s.type === "query" && domPos >= s.from && domPos <= s.to,
        );
        if (byDom) return byDom;
      } catch {
        // Ignore transient DOM lookup errors and fall back to sectionFrom
      }
    }
    return sections.find((s) => s.type === "query" && s.from === this.sectionFrom) ?? null;
  }

  private renderInto(root: Root, view: EditorView): void {
    const isReadOnly = Boolean(this.options?.readOnly || view.state.readOnly);

    const handleSaveQuery = (nextQuery: string) => {
      const targetId = this.resolveSection(view)?.id ?? this.sectionId;
      if (this.options?.onSaveQuery) {
        return this.options.onSaveQuery(targetId, nextQuery);
      }
      const result = saveBlockQuerySource(view, targetId, nextQuery);
      if (!result.ok) throw new Error(result.message);
    };

    const handleEditSource = isReadOnly
      ? undefined
      : () => {
          const section = this.resolveSection(view);
          if (!section) return;
          const targetPos = section.contentFrom ?? section.from;
          view.dispatch({
            selection: { anchor: targetPos },
            effects: setQuerySourceEditing.of({
              sectionId: section.id,
              editing: true,
            }),
          });
          view.focus();
        };

    root.render(
      <QueryBlockView
        query={this.queryText}
        widgetType={this.widgetType}
        widgetError={this.widgetError}
        attributes={this.attributes}
        tokenValues={this.tokenValues}
        readOnly={isReadOnly}
        executor={this.options?.executor}
        onResultSaved={this.options?.onResultSaved}
        onSaveQuery={handleSaveQuery}
        onEditSource={handleEditSource}
        onCaptureRpe={this.options?.onCaptureRpe}
        onEditMetric={this.options?.onEditMetric}
        onOpenNote={this.options?.onOpenNote}
        noteHref={this.options?.noteHref}
      />,
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    // Padding (never exterior margin) keeps CodeMirror's height map exact.
    container.className = "cm-query-block-preview py-1.5";
    this.container = container;
    const root = createRoot(container) as Root;
    this.root = root;
    this.renderInto(root, view);
    return container;
  }

  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    if (!this.root) return false;
    this.renderInto(this.root, view);
    return true;
  }

  destroy(): void {
    if (this.root) {
      setTimeout(() => {
        try {
          this.root?.unmount();
        } catch {
          // unmount
        }
      }, 0);
    }
  }

  ignoreEvent(): boolean {
    return true;
  }

  get block(): boolean {
    return true;
  }
}

class QueryPreviewToggleWidget extends WidgetType {
  constructor(readonly sectionId: string, readonly exitPos: number) {
    super();
  }

  eq(other: QueryPreviewToggleWidget): boolean {
    return this.sectionId === other.sectionId && this.exitPos === other.exitPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-query-preview-return-btn";
    btn.textContent = "Preview";
    btn.title = "Return to rendered query preview";
    btn.setAttribute("aria-label", "Return to query preview");

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetPos = Math.min(this.exitPos, view.state.doc.length);
      view.dispatch({
        selection: { anchor: targetPos },
        effects: setQuerySourceEditing.of({
          sectionId: this.sectionId,
          editing: false,
        }),
      });
    });

    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildQueryBlockDecos(state: EditorState, options?: QueryBlockPreviewOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections, rawContent: fullRawContent } = state.field(sectionField);
  const editingSections = state.field(editingQuerySectionsField, false) ?? new Set<string>();
  const isReadOnly = Boolean(options?.readOnly || state.readOnly);
  const { tokens: mergedTokens } = resolveQueryExecutionScope({
    noteId: options?.noteId,
    rawContent: fullRawContent,
    tokenValues: options?.tokenValues,
  });

  for (const section of sections) {
    if (section.type !== "query") continue;

    const isEditingSource = !isReadOnly && editingSections.has(section.id);
    if (isEditingSource) {
      const openLine = state.doc.line(section.startLine);
      builder.add(
        openLine.to,
        openLine.to,
        Decoration.widget({
          widget: new QueryPreviewToggleWidget(section.id, section.to),
          side: 1,
        }),
      );
      continue;
    }

    if (section.contentFrom === undefined || section.contentTo === undefined) continue;
    const rawContent = state.doc.sliceString(section.contentFrom, section.contentTo);

    builder.add(
      section.from,
      section.to,
      Decoration.replace({
        widget: new ReactQueryBlock(
          rawContent,
          section.id,
          section.from,
          section.queryType,
          section.queryError,
          section.queryAttributes,
          mergedTokens,
          options,
        ),
        block: true,
      }),
    );
  }

  return builder.finish();
}

export function saveBlockQuerySource(
  view: EditorView,
  sectionId: string,
  newQuery: string,
  queryIndex = 0,
): { ok: boolean; patchedContent?: string; message?: string } {
  if (view.state.readOnly) {
    return { ok: false, message: "Cannot modify query source in read-only mode." };
  }

  const section = findQueryBlockSection(view, sectionId);
  if (!section || section.contentFrom === undefined || section.contentTo === undefined) {
    return { ok: false, message: "Query block section not found" };
  }

  const currentContent = view.state.doc.sliceString(section.contentFrom, section.contentTo);
  const patchedContent = patchBlockQuery(currentContent, newQuery, queryIndex);

  view.dispatch({
    changes: {
      from: section.contentFrom,
      to: section.contentTo,
      insert: patchedContent,
    },
  });

  return { ok: true, patchedContent };
}

export function findQueryBlockSection(view: EditorView, sectionId: string): EditorSection | null {
  const { sections } = view.state.field(sectionField);
  return sections.find((s) => s.id === sectionId) ?? null;
}

const queryBlockPreviewTheme = EditorView.baseTheme({
  ".cm-query-preview-return-btn": {
    marginLeft: "8px",
    padding: "1px 7px",
    borderRadius: "4px",
    fontSize: "10px",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    fontWeight: "600",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
    cursor: "pointer",
  },
  ".cm-query-preview-return-btn:hover": {
    backgroundColor: "hsl(var(--muted))",
  },
});

export function queryBlockPreview(options?: QueryBlockPreviewOptions): Extension {
  const decoField = StateField.define<DecorationSet>({
    create(state) {
      return buildQueryBlockDecos(state, options);
    },
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.startState.field(sectionField) !== tr.state.field(sectionField) ||
        tr.effects.some((e) => e.is(setQuerySourceEditing) || e.is(setEditorFocused))
      ) {
        return buildQueryBlockDecos(tr.state, options);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [editingQuerySectionsField, decoField, queryBlockPreviewTheme];
}
