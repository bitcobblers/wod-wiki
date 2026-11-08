import { Decoration, WidgetType, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, RangeSetBuilder, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import React from "react";
// @ts-ignore
import { createRoot } from "react-dom/client";
import { sectionField, type EditorSection } from "./section-state";
import { resolveQueryExecutionScope } from "@bitcobblers/wod-wiki-wql";
import { QueryBlockView } from "../blocks/QueryBlockView";
import type { QueryExecutor } from "../contracts/query";
import { patchBlockQuery } from "../utils/blockQueryPatcher";

type Root = { render: (c: React.ReactNode) => void; unmount: () => void };

export interface QueryBlockPreviewOptions {
  executor?: QueryExecutor;
  onResultSaved?: (callback: () => void) => (() => void) | void;
  readOnly?: boolean;
  onSaveQuery?: (sectionId: string, nextQuery: string) => void | Promise<void>;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
  tokenValues?: Record<string, string>;
  noteId?: string;
}

class ReactQueryBlock extends WidgetType {
  private root: Root | null = null;

  constructor(
    readonly queryText: string,
    readonly sectionId: string,
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

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-query-block-preview my-2";
    const root = createRoot(container) as Root;
    this.root = root;

    const handleSaveQuery = (nextQuery: string) => {
      if (this.options?.onSaveQuery) {
        return this.options.onSaveQuery(this.sectionId, nextQuery);
      }
      const result = saveBlockQuerySource(view, this.sectionId, nextQuery);
      if (!result.ok) throw new Error(result.message);
    };

    root.render(
      <QueryBlockView
        query={this.queryText}
        widgetType={this.widgetType}
        widgetError={this.widgetError}
        attributes={this.attributes}
        tokenValues={this.tokenValues}
        readOnly={this.options?.readOnly}
        executor={this.options?.executor}
        onResultSaved={this.options?.onResultSaved}
        onSaveQuery={handleSaveQuery}
        onOpenNote={this.options?.onOpenNote}
        noteHref={this.options?.noteHref}
      />,
    );
    return container;
  }

  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    if (!this.root) return false;
    const handleSaveQuery = (nextQuery: string) => {
      if (this.options?.onSaveQuery) {
        return this.options.onSaveQuery(this.sectionId, nextQuery);
      }
      const result = saveBlockQuerySource(view, this.sectionId, nextQuery);
      if (!result.ok) throw new Error(result.message);
    };
    this.root.render(
      <QueryBlockView
        query={this.queryText}
        widgetType={this.widgetType}
        widgetError={this.widgetError}
        attributes={this.attributes}
        tokenValues={this.tokenValues}
        readOnly={this.options?.readOnly}
        executor={this.options?.executor}
        onResultSaved={this.options?.onResultSaved}
        onOpenNote={this.options?.onOpenNote}
        noteHref={this.options?.noteHref}
        onSaveQuery={handleSaveQuery}
      />,
    );
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

  get block(): boolean {
    return true;
  }
}

function buildQueryBlockDecos(state: EditorState, options?: QueryBlockPreviewOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections, rawContent: fullRawContent } = state.field(sectionField);
  const cursor = state.selection.main.head;
  const { tokens: mergedTokens } = resolveQueryExecutionScope({
    noteId: options?.noteId,
    rawContent: fullRawContent,
    tokenValues: options?.tokenValues,
  });

  for (const section of sections) {
    if (section.type !== "query") continue;

    // Show raw markdown if cursor is within the block
    if (cursor >= section.from && cursor <= section.to) continue;

    if (section.contentFrom === undefined || section.contentTo === undefined) continue;
    const rawContent = state.doc.sliceString(section.contentFrom, section.contentTo);

    builder.add(
      section.from,
      section.to,
      Decoration.replace({
        widget: new ReactQueryBlock(
          rawContent,
          section.id,
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

export function queryBlockPreview(options?: QueryBlockPreviewOptions): Extension {
  const decoField = StateField.define<DecorationSet>({
    create(state) {
      return buildQueryBlockDecos(state, options);
    },
    update(deco, tr) {
      if (tr.docChanged || tr.selection) {
        return buildQueryBlockDecos(tr.state, options);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [decoField];
}
