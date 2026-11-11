import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { sectionField, type EditorSection } from "./section-state";
import { isEditorFocused, setEditorFocused } from "./editor-focus";
import { navigationFacet } from "./link-open";

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?$/.test(line.trim()) && line.includes("|");
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner =
    trimmed.startsWith("|") && trimmed.endsWith("|")
      ? trimmed.slice(1, -1)
      : trimmed.startsWith("|")
        ? trimmed.slice(1)
        : trimmed.endsWith("|")
          ? trimmed.slice(0, -1)
          : trimmed;
  return inner.split("|").map((c) => c.trim());
}

function serializeMarkdownTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const colCount = Math.max(
    head.length,
    ...rows.map((r) => r.length),
    1,
  );
  const normHead = Array.from({ length: colCount }, (_, i) => (head[i] ?? `Col ${i + 1}`).replace(/\|/g, "\\|"));
  const sep = Array.from({ length: colCount }, () => "---");
  const normRows = rows.map((row) =>
    Array.from({ length: colCount }, (_, i) => (row[i] ?? "").replace(/\|/g, "\\|")),
  );

  const formatRow = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [
    formatRow(normHead),
    formatRow(sep),
    ...normRows.map(formatRow),
  ].join("\n");
}

function appendFormattedCellContent(
  container: HTMLElement,
  rawText: string,
  view: EditorView,
): void {
  const tokenRe = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(rawText.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.className = "font-semibold";
      strong.textContent = token.slice(2, -2);
      container.appendChild(strong);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      const em = document.createElement("em");
      em.className = "italic";
      em.textContent = token.slice(1, -1);
      container.appendChild(em);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.className = "cm-md-inline-code";
      code.textContent = token.slice(1, -1);
      container.appendChild(code);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const label = match[2];
      const url = match[3];
      const a = document.createElement("a");
      a.href = url;
      a.textContent = label;
      a.className = "cm-table-cell-link underline underline-offset-2";
      const isExternal = /^https?:\/\//i.test(url);
      if (isExternal) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!isExternal) {
          const navHook = view.state.facet(navigationFacet);
          if (navHook) {
            e.preventDefault();
            navHook(url, view);
          }
        }
      });
      container.appendChild(a);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < rawText.length) {
    container.appendChild(document.createTextNode(rawText.slice(lastIndex)));
  }
}

interface ParsedTable {
  head: string[];
  rows: string[][];
  fromLine: number;
  toLine: number;
}

class MarkdownTableWidget extends WidgetType {
  constructor(
    readonly head: string[],
    readonly rows: string[][],
    readonly from: number,
    readonly to: number,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: MarkdownTableWidget): boolean {
    if (
      this.readOnly !== other.readOnly ||
      this.from !== other.from ||
      this.to !== other.to ||
      this.head.length !== other.head.length ||
      this.rows.length !== other.rows.length
    ) {
      return false;
    }
    if (!this.head.every((h, i) => h === other.head[i])) return false;
    return this.rows.every(
      (row, rIdx) =>
        row.length === other.rows[rIdx].length &&
        row.every((cell, cIdx) => cell === other.rows[rIdx][cIdx]),
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement("div");
    // Padding instead of exterior margin keeps CM6 height map exact.
    outer.className = "cm-table-preview-outer py-1.5";

    const wrap = document.createElement("div");
    wrap.className = "cm-table-preview overflow-auto border border-border rounded-[8px] bg-card";

    const colCount = Math.max(
      this.head.length,
      ...this.rows.map((r) => r.length),
      1,
    );
    const mutableHead = Array.from({ length: colCount }, (_, i) => this.head[i] ?? "");
    const mutableRows = this.rows.map((row) =>
      Array.from({ length: colCount }, (_, i) => row[i] ?? ""),
    );

    const commitTable = (
      nextHead: string[],
      nextRows: string[][],
      focusAfter?: { row: number; col: number },
    ) => {
      if (view.state.readOnly) return;
      const serialized = serializeMarkdownTable(nextHead, nextRows);
      // Keep selection safely outside `from..to` so the rendered table stays mounted!
      const safeSelection =
        this.to < view.state.doc.length
          ? Math.min(view.state.doc.length, this.from + serialized.length + 1)
          : Math.max(0, this.from - 1);
      const currentCursor = view.state.selection.main.head;
      const nextCursor =
        currentCursor >= this.from && currentCursor <= this.to
          ? safeSelection
          : currentCursor > this.to
            ? currentCursor + (serialized.length - (this.to - this.from))
            : currentCursor;

      view.dispatch({
        changes: { from: this.from, to: this.to, insert: serialized },
        selection: { anchor: Math.max(0, Math.min(nextCursor, view.state.doc.length + serialized.length - (this.to - this.from))) },
        userEvent: "input.table",
      });

      if (focusAfter) {
        requestAnimationFrame(() => {
          const targetCell = view.dom.querySelector<HTMLElement>(
            `[data-table-from="${this.from}"] [data-cell-coord="${focusAfter.row}:${focusAfter.col}"]`,
          );
          targetCell?.click();
        });
      }
    };

    wrap.dataset.tableFrom = String(this.from);

    const openCellEditor = (
      cellEl: HTMLTableCellElement,
      rowIndex: number, // -1 for header, 0..N-1 for body
      colIndex: number,
    ) => {
      if (this.readOnly || view.state.readOnly) return;
      if (cellEl.querySelector("input")) return;

      const initialValue =
        rowIndex < 0 ? mutableHead[colIndex] ?? "" : mutableRows[rowIndex]?.[colIndex] ?? "";

      cellEl.textContent = "";
      const input = document.createElement("input");
      input.type = "text";
      input.value = initialValue;
      input.className = "cm-table-cell-input";
      input.setAttribute(
        "aria-label",
        rowIndex < 0
          ? `Edit header column ${colIndex + 1}`
          : `Edit row ${rowIndex + 1} column ${colIndex + 1}`,
      );

      let committed = false;
      const saveCell = (focusTarget?: { row: number; col: number }) => {
        if (committed) return;
        committed = true;
        const nextVal = input.value.trim();
        if (rowIndex < 0) {
          mutableHead[colIndex] = nextVal;
        } else if (mutableRows[rowIndex]) {
          mutableRows[rowIndex][colIndex] = nextVal;
        }
        if (nextVal !== initialValue || focusTarget) {
          commitTable(mutableHead, mutableRows, focusTarget);
        } else {
          cellEl.textContent = "";
          appendFormattedCellContent(cellEl, initialValue, view);
        }
      };

      input.addEventListener("mousedown", (e) => e.stopPropagation());
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Tab") {
          e.preventDefault();
          const dir = e.shiftKey ? -1 : 1;
          let nextRow = rowIndex;
          let nextCol = colIndex + dir;
          if (nextCol >= colCount) {
            nextCol = 0;
            nextRow = rowIndex + 1;
          } else if (nextCol < 0) {
            nextCol = colCount - 1;
            nextRow = rowIndex - 1;
          }
          if (nextRow >= mutableRows.length) {
            mutableRows.push(Array.from({ length: colCount }, () => ""));
            committed = true;
            const nextVal = input.value.trim();
            if (rowIndex < 0) mutableHead[colIndex] = nextVal;
            else if (mutableRows[rowIndex]) mutableRows[rowIndex][colIndex] = nextVal;
            commitTable(mutableHead, mutableRows, { row: nextRow, col: 0 });
            return;
          }
          if (nextRow < -1) nextRow = -1;
          saveCell({ row: nextRow, col: nextCol });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const nextRow = rowIndex + 1;
          if (nextRow >= mutableRows.length) {
            mutableRows.push(Array.from({ length: colCount }, () => ""));
            committed = true;
            const nextVal = input.value.trim();
            if (rowIndex < 0) mutableHead[colIndex] = nextVal;
            else if (mutableRows[rowIndex]) mutableRows[rowIndex][colIndex] = nextVal;
            commitTable(mutableHead, mutableRows, { row: nextRow, col: colIndex });
            return;
          }
          saveCell({ row: nextRow, col: colIndex });
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committed = true;
          cellEl.textContent = "";
          appendFormattedCellContent(cellEl, initialValue, view);
        }
      });

      input.addEventListener("blur", () => {
        saveCell();
      });

      cellEl.appendChild(input);
      input.focus();
      input.select();
    };

    const table = document.createElement("table");
    table.className = "cm-table-grid w-full text-xs border-collapse";

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    htr.className = "border-b border-border bg-muted/45 text-muted-foreground text-left";
    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const h = mutableHead[cIdx] ?? "";
      const th = document.createElement("th");
      th.className = "py-2 px-3 font-semibold tracking-tight select-text";
      th.dataset.cellCoord = `-1:${cIdx}`;
      appendFormattedCellContent(th, h, view);
      if (!this.readOnly) {
        th.addEventListener("mousedown", (e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          e.preventDefault();
          e.stopPropagation();
        });
        th.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          e.preventDefault();
          e.stopPropagation();
          openCellEditor(th, -1, cIdx);
        });
      }
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    mutableRows.forEach((row, rIdx) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-border/50 last:border-b-0 hover:bg-muted/25";
      for (let cIdx = 0; cIdx < colCount; cIdx++) {
        const cell = row[cIdx] ?? "";
        const td = document.createElement("td");
        td.className = "py-2 px-3 text-foreground font-mono tabular-nums select-text";
        td.dataset.cellCoord = `${rIdx}:${cIdx}`;
        appendFormattedCellContent(td, cell, view);
        if (!this.readOnly) {
          td.addEventListener("mousedown", (e) => {
            if ((e.target as HTMLElement).closest("a")) return;
            e.preventDefault();
            e.stopPropagation();
          });
          td.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).closest("a")) return;
            e.preventDefault();
            e.stopPropagation();
            openCellEditor(td, rIdx, cIdx);
          });
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (!this.readOnly) {
      const footer = document.createElement("div");
      footer.className = "cm-table-controls";

      const makeBtn = (label: string, aria: string, onClick: () => void) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cm-table-control-btn";
        btn.textContent = label;
        btn.setAttribute("aria-label", aria);
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        return btn;
      };

      footer.appendChild(
        makeBtn("+ Row", "Add table row", () => {
          const nextRows = [
            ...mutableRows,
            Array.from({ length: colCount }, () => ""),
          ];
          commitTable(mutableHead, nextRows, { row: nextRows.length - 1, col: 0 });
        }),
      );

      footer.appendChild(
        makeBtn("+ Column", "Add table column", () => {
          const nextHead = [...mutableHead, `Col ${colCount + 1}`];
          const nextRows = mutableRows.map((r) => [...r, ""]);
          commitTable(nextHead, nextRows, { row: -1, col: colCount });
        }),
      );

      const sourceBtn = makeBtn("Source", "Edit raw Markdown table", () => {
        view.dispatch({ selection: { anchor: this.from } });
        view.focus();
      });
      sourceBtn.style.marginLeft = "auto";
      footer.appendChild(sourceBtn);

      wrap.appendChild(footer);
    }

    outer.appendChild(wrap);
    return outer;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get block(): boolean {
    return true;
  }
}

/**
 * Locate ALL contiguous runs of `|`-lines inside a Markdown section that form
 * valid GFM tables (header + separator on their first two lines).
 */
function parseSectionTables(
  state: EditorState,
  section: EditorSection,
): ParsedTable[] {
  const runs: { fromLine: number; toLine: number }[] = [];
  for (let l = section.startLine; l <= section.endLine; l++) {
    const trimmed = state.doc.line(l).text.trim();
    if (!trimmed.startsWith("|")) continue;
    const last = runs[runs.length - 1];
    if (last && last.toLine === l - 1) last.toLine = l;
    else runs.push({ fromLine: l, toLine: l });
  }

  const tables: ParsedTable[] = [];
  for (const run of runs) {
    const lines: string[] = [];
    for (let l = run.fromLine; l <= run.toLine; l++) {
      lines.push(state.doc.line(l).text);
    }
    if (lines.length < 2 || !isTableSeparator(lines[1].trim())) continue;

    const head = parseTableCells(lines[0]);
    const rows = lines.slice(2).map(parseTableCells);
    tables.push({ head, rows, fromLine: run.fromLine, toLine: run.toLine });
  }

  return tables;
}

function buildTableDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections } = state.field(sectionField);
  const sel = state.selection.main;
  const canRevealRaw = !state.readOnly && isEditorFocused(state);

  for (const section of sections) {
    if (section.type !== "markdown") continue;

    const tables = parseSectionTables(state, section);
    for (const parsed of tables) {
      const from = state.doc.line(parsed.fromLine).from;
      const to = state.doc.line(parsed.toLine).to;
      if (canRevealRaw && sel.from <= to && sel.to >= from) continue;

      builder.add(
        from,
        to,
        Decoration.replace({
          widget: new MarkdownTableWidget(
            parsed.head,
            parsed.rows,
            from,
            to,
            state.readOnly,
          ),
          block: true,
        }),
      );
    }
  }

  return builder.finish();
}

const tablePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecos(state);
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setEditorFocused))
    ) {
      return buildTableDecos(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const tablePreviewTheme = EditorView.baseTheme({
  ".cm-table-cell-input": {
    width: "100%",
    minWidth: "64px",
    padding: "2px 4px",
    fontSize: "12px",
    fontFamily: "inherit",
    color: "hsl(var(--foreground))",
    backgroundColor: "hsl(var(--background))",
    border: "1px solid hsl(var(--foreground))",
    borderRadius: "3px",
    outline: "none",
  },
  ".cm-table-controls": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 8px",
    borderTop: "1px solid hsl(var(--border) / 0.7)",
    backgroundColor: "hsl(var(--muted) / 0.25)",
  },
  ".cm-table-control-btn": {
    padding: "2px 7px",
    fontSize: "10.5px",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
    fontWeight: "500",
    color: "hsl(var(--muted-foreground))",
    backgroundColor: "transparent",
    border: "1px solid hsl(var(--border))",
    borderRadius: "4px",
    cursor: "pointer",
  },
  ".cm-table-control-btn:hover": {
    color: "hsl(var(--foreground))",
    backgroundColor: "hsl(var(--muted) / 0.65)",
  },
  ".cm-table-cell-link": {
    color: "hsl(var(--foreground))",
  },
});

export const markdownTablePreview: Extension = [
  tablePreviewField,
  tablePreviewTheme,
];
