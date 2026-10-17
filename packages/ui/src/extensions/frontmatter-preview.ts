import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, EditorState, RangeSetBuilder, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { parseFrontmatterBody, type ParsedFrontmatter } from "@bitcobblers/wod-wiki-wql";
import { patchFrontmatterProperty } from "@bitcobblers/wod-wiki-core";
import { EFFORT_DISCIPLINES } from "@bitcobblers/wod-wiki-lang";
import { sectionField } from "./section-state";

// ponytail: flat scalar and string-list properties with inline commit; add schema types / drag-to-reorder when multi-type nested schemas are required.
export interface FrontmatterCatalogEntry {
  slug: string;
  label: string;
  aliases: readonly string[];
}

export type FrontmatterSuggestionCatalog = {
  types: readonly string[];
  tags: readonly { label: string; type?: string }[];
  /** Effort catalog for reference lookups and chip suggestions (optional — providers without a registry omit it). */
  efforts?: readonly FrontmatterCatalogEntry[];
  /** Equipment catalog for reference lookups and chip suggestions. */
  equipment?: readonly FrontmatterCatalogEntry[];
};

export const frontmatterSuggestions = Facet.define<
  () => Promise<FrontmatterSuggestionCatalog>,
  (() => Promise<FrontmatterSuggestionCatalog>) | null
>({ combine: (providers) => providers[0] ?? null });

// ── Shared reference resolver seam ───────────────────────────────────
// Structural mirror of lang's ReferenceIndex plus the app-owned href
// builders; the app supplies the real shared resolver via
// `frontmatterReferenceIndex` so the widget never re-resolves or
// hard-codes routes.

export interface FrontmatterReferenceRef {
  kind: 'effort' | 'equipment';
  slug: string;
  label: string;
}

export interface FrontmatterRefDiagnostic {
  reason: string;
  message: string;
  token?: string;
  candidates?: readonly string[];
}

export interface FrontmatterReferenceResolution {
  matched: string;
  effortRef: FrontmatterReferenceRef | null;
  equipment: readonly FrontmatterReferenceRef[];
  diagnostics: readonly FrontmatterRefDiagnostic[];
}

export interface FrontmatterReferenceProvider {
  resolve(
    label: string,
    defaults?: { effort?: string; equipment?: readonly string[] },
  ): FrontmatterReferenceResolution;
  resolveEffort(slugOrAlias: string): { slug: string; label: string } | null;
  resolveEquipment(slugOrAlias: string): { slug: string; label: string } | null;
  /** Route href for an existing effort/equipment page (app-owned). */
  openHref(kind: FrontmatterReferenceRef['kind'], slug: string): string;
  /** Route href for the create page of a kind (app-owned). */
  createHref(kind: FrontmatterReferenceRef['kind']): string;
}

export const frontmatterReferenceIndex = Facet.define<
  () => FrontmatterReferenceProvider | null,
  (() => FrontmatterReferenceProvider | null) | null
>({ combine: (providers) => providers[0] ?? null });

/**
 * Sent when the reference catalog behind `frontmatterReferenceIndex`
 * changes (seed import, registry refresh). Forces the frontmatter preview
 * to rebuild so chips/diagnostics reflect the new catalog without waiting
 * for an unrelated doc/selection change.
 */
export const referenceIndexReload = StateEffect.define<null>();

/** Kind of definition document the frontmatter declares, if any. */
type DefinitionKind = 'effort' | 'equipment' | null;

export const frontmatterVisibility = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});

const pendingFocus = new WeakMap<EditorView, { kind: "key" | "tag"; key: string }>();
const widgetCleanup = new WeakMap<HTMLElement, (() => void)[]>();
let suggestionId = 0;

function isTagProperty(key: string): boolean {
  return ["tag", "tags", "category"].includes(key.trim().toLowerCase());
}

function attachSuggestions(
  input: HTMLInputElement,
  view: EditorView,
  root: HTMLElement,
  kind: "key" | "value",
  key: string,
  excluded: readonly string[],
  commit: () => void,
  valueKind: "tags" | "effort" | "equipment" = "tags",
): void {
  const provider = view.state.facet(frontmatterSuggestions);
  if (!provider || !input.parentElement) return;
  const parent = input.parentElement;
  parent.classList.add("relative");
  const list = document.createElement("div");
  list.id = `frontmatter-suggestions-${++suggestionId}`;
  list.setAttribute("role", "listbox");
  list.className = "absolute left-0 top-full z-50 max-h-48 overflow-auto rounded-md border border-border bg-background shadow-md min-w-full text-xs";
  list.hidden = true;
  parent.appendChild(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  let generation = 0;
  let choices: Array<{ value: string; label: string }> = [];
  let active = -1;
  const close = () => {
    generation++;
    choices = [];
    active = -1;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const select = (choice: { value: string; label: string }) => {
    input.value = choice.value;
    close();
    commit();
  };
  const activate = (index: number) => {
    active = index;
    Array.from(list.children).forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === active));
      option.classList.toggle("bg-muted", i === active);
    });
    const option = list.children[active];
    if (option) {
      input.setAttribute("aria-activedescendant", option.id);
      if (option instanceof HTMLElement) option.scrollIntoView?.({ block: "nearest" });
    }
  };
  // Focus and Ctrl+Space open the full candidate list; typing filters it.
  const refresh = async (showAll = false) => {
    close();
    const request = ++generation;
    const query = showAll ? "" : input.value.trim().toLowerCase();
    try {
      const catalog = await provider();
      if (request !== generation || !input.isConnected || document.activeElement !== input) return;
      let candidates: Array<{ value: string; label: string; haystack: string }>;
      if (kind === "key") {
        candidates = catalog.types.map((name) => ({ value: name, label: name, haystack: name }));
      } else if (valueKind === "effort" || valueKind === "equipment") {
        const entries = valueKind === "effort" ? (catalog.efforts ?? []) : (catalog.equipment ?? []);
        // Canonical value is the slug; the authored token keeps working because
        // aliases are searchable but never written.
        candidates = entries.map((entry) => ({
          value: entry.slug,
          label: `${entry.label} (${entry.slug})`,
          haystack: [entry.label, entry.slug, ...entry.aliases].join(" ").toLowerCase(),
        }));
      } else {
        candidates = catalog.tags
          .filter((tag) => isTagProperty(key) || tag.type?.toLowerCase() === key.trim().toLowerCase())
          .map((tag) => ({ value: tag.label, label: tag.label, haystack: tag.label.toLowerCase() }));
      }
      const selected = new Set(excluded.map((label) => label.toLowerCase()));
      choices = candidates.filter(
        (candidate) =>
          (query === "" || candidate.haystack.includes(query)) &&
          !selected.has(candidate.value.toLowerCase()),
      );
      active = -1;
      input.removeAttribute("aria-activedescendant");
      list.replaceChildren();
      choices.forEach((choice, index) => {
        const option = document.createElement("div");
        option.id = `${list.id}-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.className = "cursor-pointer px-2 py-1.5 hover:bg-muted";
        option.textContent = choice.label;
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => select(choice));
        list.appendChild(option);
      });
      list.hidden = choices.length === 0;
      input.setAttribute("aria-expanded", String(choices.length > 0));
    } catch {
      if (request === generation) close();
    }
  };
  input.addEventListener("focus", () => void refresh(true));
  input.addEventListener("input", () => void refresh(false));
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (event) => {
    if (event.ctrlKey && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      void refresh(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && choices.length) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activate(active < 0 ? (direction === 1 ? 0 : choices.length - 1) : (active + direction + choices.length) % choices.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && active >= 0) {
      event.preventDefault();
      select(choices[active]);
    }
  });
  widgetCleanup.get(root)?.push(close);
}

function parseTagList(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof val === "string" && val.trim()) {
    const s = val.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      return s
        .slice(1, -1)
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    return [s.replace(/^['"]|['"]$/g, "")];
  }
  return [];
}

/** Patch ONE property via the shared core helper: one change = one undo, and
 *  everything outside the target property survives. Never reserialize the
 *  flat map — that drops nested YAML. */
function patchPropertyInView(
  view: EditorView,
  _sectionId: string,
  path: readonly string[],
  value: string | number | readonly string[] | null,
): void {
  if (view.state.readOnly) return;
  const wholeDoc = view.state.doc.toString();
  const next = patchFrontmatterProperty(wholeDoc, path, value);
  if (next === wholeDoc) return;
  view.dispatch({ changes: { from: 0, to: wholeDoc.length, insert: next } });
}

/** Key rename = write the new key, drop the old one — one dispatch, one undo. */
function renamePropertyInView(
  view: EditorView,
  _sectionId: string,
  fromKey: string,
  toKey: string,
  value: string | number | readonly string[],
): void {
  if (view.state.readOnly) return;
  const wholeDoc = view.state.doc.toString();
  const next = patchFrontmatterProperty(
    patchFrontmatterProperty(wholeDoc, [toKey], value),
    [fromKey],
    null,
  );
  if (next === wholeDoc) return;
  view.dispatch({ changes: { from: 0, to: wholeDoc.length, insert: next } });
}

function detectDefinitionKind(meta: ParsedFrontmatter['meta']): DefinitionKind {
  const type = typeof meta.type === "string" ? meta.type.trim().toLowerCase() : "";
  if (type === "effort") return "effort";
  if (type === "equipment") return "equipment";
  // Legacy effort envelope: bundled/user effort docs carry registrySource or
  // a nested baseAttributes block without a type key.
  if (meta.registrySource !== undefined || meta.baseAttributes !== undefined) return "effort";
  return null;
}

/** ponytail: tolerant draft reader for display only — swaps to the shared lang parser once it tolerates incomplete drafts; all writes go through patchFrontmatterProperty. */
function readBaseAttributes(body: string): { met?: string; discipline?: string; intensityTier?: string } {
  const out: { met?: string; discipline?: string; intensityTier?: string } = {};
  let inBase = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^baseAttributes:\s*(#.*)?$/.test(line)) {
      inBase = true;
      continue;
    }
    if (!inBase) continue;
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (!match) continue;
    if (match[1] === "met" || match[1] === "discipline" || match[1] === "intensityTier") {
      out[match[1]] = unquoteYamlScalar(match[2].trim());
    }
  }
  return out;
}

function unquoteYamlScalar(val: string): string {
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1).replace(/\\'/g, "'");
  return val;
}

/** Suggestion candidate kind for a property's value editor. */
function referenceValueKind(key: string, docKind: DefinitionKind): "tags" | "effort" | "equipment" {
  const normalized = key.trim().toLowerCase();
  if (normalized === "metrics.effort") return "effort";
  if (normalized === "metrics.equipment" || normalized === "equipment") return "equipment";
  if (normalized === "aliases" && docKind === "equipment") return "equipment";
  if (normalized === "aliases" && docKind === "effort") return "effort";
  return "tags";
}

/** True when the property's values are durable effort/equipment references. */
function isReferenceKey(key: string, docKind: DefinitionKind): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized === "metrics.effort" || normalized === "metrics.equipment") return true;
  return normalized === "equipment" && docKind === "effort";
}

/** Numeric note-default metric keys authored as flat `metrics.*` properties ride the generic scalar editor. */

// Imperative, unpersisted tag-entry row for when no tags property exists yet.
// Only a committed value patches the document; blur/Escape without a value discards it.
function createTagDraftRow(
  view: EditorView,
  root: HTMLElement,
  key: string,
  onCommit: (value: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className =
    "flex items-center min-h-[34px] border-b border-dashed border-border/60 last:border-b-0 group hover:bg-muted/10 transition-colors max-[479px]:flex-col max-[479px]:items-stretch";
  row.setAttribute("data-frontmatter-tag-draft", "true");

  const keyCol = document.createElement("div");
  keyCol.className =
    "flex items-center gap-2 px-3 py-1.5 w-36 shrink-0 border-r border-dashed border-border/60 text-muted-foreground max-[479px]:w-auto max-[479px]:border-r-0 max-[479px]:border-b";
  keyCol.appendChild(createTagIcon());
  const keyLabel = document.createElement("span");
  keyLabel.className = "truncate font-medium text-foreground/90";
  keyLabel.textContent = key;
  keyCol.appendChild(keyLabel);
  row.appendChild(keyCol);

  const valCol = document.createElement("div");
  valCol.className = "flex items-center flex-wrap gap-1.5 px-3 py-1.5 flex-1 min-w-0";
  const input = document.createElement("input");
  input.className =
    "flex-1 min-w-[70px] bg-transparent text-xs text-foreground outline-none px-1 py-0.5 placeholder:text-muted-foreground/40";
  input.placeholder = "Add tag…";
  input.setAttribute("aria-label", `Add tag to ${key}`);
  valCol.appendChild(input);
  row.appendChild(valCol);

  let settled = false;
  const settle = (commit: boolean) => {
    if (settled) return;
    settled = true;
    if (commit) {
      const val = input.value.trim().replace(/^,|,$/g, "");
      if (val) onCommit(val);
    }
    row.remove();
    view.requestMeasure();
  };
  const commit = () => settle(true);
  const discard = () => settle(false);

  attachSuggestions(input, view, root, "value", key, [], commit);
  input.addEventListener("keydown", (e) => {
    // Escape discards the draft even when attachSuggestions already closed the
    // listbox and prevented default on the same event.
    if (e.key === "Escape") {
      e.preventDefault();
      discard();
      return;
    }
    if (e.defaultPrevented) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    }
  });
  input.addEventListener("blur", () => queueMicrotask(() => {
    if (!input.isConnected) return;
    if (input.value.trim()) commit();
    else discard();
  }));

  return row;
}

/** True when `key:` has no inline value and an indented block follows. */
function ownsNestedBlock(body: string, key: string): boolean {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`).test(lines[i])) continue;
    return i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]);
  }
  return false;
}

/**
 * Diagnostics strip for a note-default `metrics.effort` value. Unknown or
 * ambiguous references stay visible; actions select an existing canonical
 * slug or open the create page — the authored value is never silently
 * rewritten.
 */
function renderEffortValueDiagnostics(
  provider: FrontmatterReferenceProvider,
  token: string,
  onPick: (slug: string) => void,
): HTMLElement | null {
  const trimmed = token.trim();
  if (!trimmed || provider.resolveEffort(trimmed)) return null;
  const diagnostics = provider.resolve(trimmed).diagnostics;
  const box = document.createElement("div");
  box.setAttribute("data-testid", "editor-ref-unknown");
  box.className = "w-full basis-full flex flex-wrap items-center gap-2 text-[10px] text-destructive";
  const message = document.createElement("span");
  message.textContent = diagnostics[0]?.message || `Unknown effort: ${trimmed}`;
  box.appendChild(message);
  for (const candidate of diagnostics[0]?.candidates ?? []) {
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.textContent = `Use ${candidate}`;
    pickBtn.className = "underline hover:text-foreground cursor-pointer";
    pickBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onPick(candidate);
    });
    box.appendChild(pickBtn);
  }
  const createLink = document.createElement("a");
  createLink.href = provider.createHref("effort");
  createLink.textContent = "Create page";
  createLink.className = "underline hover:text-foreground";
  box.appendChild(createLink);
  return box;
}

const METRIC_DRAFT_KINDS: Record<string, { label: string; path: string; kind: "effort" | "equipment" | "number" }> = {
  effort: { label: "Effort", path: "metrics.effort", kind: "effort" },
  equipment: { label: "Equipment", path: "metrics.equipment", kind: "equipment" },
  rpe: { label: "RPE", path: "metrics.rpe", kind: "number" },
};

/**
 * Unpersisted note-default metric entry row. Only a committed value patches
 * the document (one change = one undo step); blur/Escape discards.
 */
function createMetricDraftRow(
  view: EditorView,
  root: HTMLElement,
  referenceProvider: FrontmatterReferenceProvider | null,
  commit: (path: readonly string[], value: string | number | readonly string[]) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className =
    "flex items-center min-h-[34px] border-b border-dashed border-border/60 last:border-b-0 group hover:bg-muted/10 transition-colors max-[479px]:flex-col max-[479px]:items-stretch";
  row.setAttribute("data-frontmatter-metric-draft", "true");

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Metric kind");
  select.className =
    "mx-3 my-1.5 h-7 w-28 shrink-0 rounded-md border border-input bg-background px-1.5 text-[11px] text-muted-foreground outline-none";
  for (const [value, spec] of Object.entries(METRIC_DRAFT_KINDS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = spec.label;
    select.appendChild(option);
  }
  row.appendChild(select);

  const valCol = document.createElement("div");
  valCol.className = "flex items-center flex-wrap gap-1.5 px-3 py-1.5 flex-1 min-w-0";
  const input = document.createElement("input");
  input.className =
    "flex-1 min-w-[70px] bg-transparent text-xs text-foreground outline-none px-1 py-0.5 placeholder:text-muted-foreground/40";
  input.placeholder = "Value…";
  input.setAttribute("aria-label", "Metric value");
  valCol.appendChild(input);
  row.appendChild(valCol);

  let settled = false;
  const settle = (doCommit: boolean) => {
    if (settled) return;
    settled = true;
    const spec = METRIC_DRAFT_KINDS[select.value];
    const raw = input.value.trim();
    if (doCommit && spec && raw) {
      if (spec.kind === "equipment") commit([spec.path], [raw]);
      else if (spec.kind === "number") {
        const num = Number(raw);
        if (!Number.isNaN(num)) commit([spec.path], num);
      } else commit([spec.path], raw);
    }
    row.remove();
    view.requestMeasure();
  };

  const attachFor = () => {
    const spec = METRIC_DRAFT_KINDS[select.value];
    if (spec && (spec.kind === "effort" || spec.kind === "equipment") && referenceProvider) {
      attachSuggestions(input, view, root, "value", spec.path, [], () => settle(true), spec.kind);
    }
  };
  attachFor();
  select.addEventListener("change", attachFor);
  input.addEventListener("keydown", (e) => {
    if (e.defaultPrevented && e.key !== "Escape") return;
    if (e.key === "Escape") {
      e.preventDefault();
      settle(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      settle(true);
    }
  });
  input.addEventListener("blur", () => queueMicrotask(() => {
    if (!input.isConnected) return;
    settle(input.value.trim().length > 0);
  }));
  select.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      settle(false);
    }
  });

  return row;
}

function createTagIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "shrink-0 h-3.5 w-3.5 text-muted-foreground/70");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z");
  svg.appendChild(path);

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "7");
  circle.setAttribute("cy", "7");
  circle.setAttribute("r", ".5");
  circle.setAttribute("fill", "currentColor");
  svg.appendChild(circle);

  return svg;
}

function createListIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "shrink-0 h-3.5 w-3.5 text-muted-foreground/70");

  for (const y of ["6", "12", "18"]) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "4");
    line.setAttribute("x2", "20");
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    svg.appendChild(line);
  }

  return svg;
}

function createPlusIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "shrink-0 h-3 w-3");

  const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l1.setAttribute("x1", "12");
  l1.setAttribute("x2", "12");
  l1.setAttribute("y1", "5");
  l1.setAttribute("y2", "19");
  svg.appendChild(l1);

  const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l2.setAttribute("x1", "5");
  l2.setAttribute("x2", "19");
  l2.setAttribute("y1", "12");
  l2.setAttribute("y2", "12");
  svg.appendChild(l2);

  return svg;
}

function createExternalIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "h-3 w-3");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M15 3h6v6");
  svg.appendChild(path);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "10");
  line.setAttribute("x2", "21");
  line.setAttribute("y1", "14");
  line.setAttribute("y2", "3");
  svg.appendChild(line);

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "21 14 21 3 10 3");
  svg.appendChild(polyline);

  return svg;
}

function createCloseIcon(size: "sm" | "md" = "md"): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", size === "sm" ? "2.5" : "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5");

  const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l1.setAttribute("x1", "18");
  l1.setAttribute("x2", "6");
  l1.setAttribute("y1", "6");
  l1.setAttribute("y2", "18");
  svg.appendChild(l1);

  const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l2.setAttribute("x1", "6");
  l2.setAttribute("x2", "18");
  l2.setAttribute("y1", "6");
  l2.setAttribute("y2", "18");
  svg.appendChild(l2);

  return svg;
}

export class DefaultFrontmatterWidget extends WidgetType {
  readonly sectionId: string;
  readonly rawContent: string;
  readonly readOnly: boolean;

  constructor(sectionId: string, rawContent?: string, readOnly: boolean = false) {
    super();
    this.sectionId = sectionId;
    this.rawContent = rawContent ?? "";
    this.readOnly = readOnly;
  }

  eq(other: DefaultFrontmatterWidget): boolean {
    return (
      this.sectionId === other.sectionId &&
      this.rawContent === other.rawContent &&
      this.readOnly === other.readOnly
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    widgetCleanup.set(root, []);
    root.className = "cm-frontmatter-preview py-2 font-sans select-none";

    const heading = document.createElement("div");
    heading.className = "text-xs font-medium text-muted-foreground mb-1.5 px-0.5";
    heading.textContent = "Properties";
    root.appendChild(heading);

    const box = document.createElement("div");
    box.className = "rounded-lg border border-border/80 bg-background/50 text-xs shadow-xs";
    root.appendChild(box);

    const body = this.rawContent.replace(/^---\r?\n?/, "").replace(/\r?\n?---\r?$/, "");
    const meta = parseFrontmatterBody(body);
    const entries = Object.entries(meta);
    const docKind = detectDefinitionKind(meta);
    const referenceProvider = view.state.facet(frontmatterReferenceIndex)?.() ?? null;
    const base = docKind === "effort" ? readBaseAttributes(body) : {};

    if (entries.length === 0) {
      const emptyRow = document.createElement("div");
      emptyRow.className = "px-3 py-2 text-xs text-muted-foreground/60 italic";
      emptyRow.textContent = "No properties";
      box.appendChild(emptyRow);
    }

    for (const [key, value] of entries) {
      const isTags = isTagProperty(key);
      const valueKind = referenceValueKind(key, docKind);
      const isReferenceList = (isReferenceKey(key, docKind) || key === "aliases") && Array.isArray(value);
      const nested = value === "" && ownsNestedBlock(body, key);

      const row = document.createElement("div");
      row.className =
        "flex items-center min-h-[34px] border-b border-dashed border-border/60 last:border-b-0 group hover:bg-muted/10 transition-colors max-[479px]:flex-col max-[479px]:items-stretch";
      box.appendChild(row);

      // Key column
      const keyCol = document.createElement("div");
      keyCol.className =
        "flex items-center gap-2 px-3 py-1.5 w-36 shrink-0 border-r border-dashed border-border/60 text-muted-foreground max-[479px]:w-auto max-[479px]:border-r-0 max-[479px]:border-b";
      keyCol.appendChild(isTags || isReferenceList ? createTagIcon() : createListIcon());

      if (this.readOnly || nested) {
        const keyLabel = document.createElement("span");
        keyLabel.className = "truncate font-medium text-foreground/90";
        keyLabel.textContent = key;
        keyCol.appendChild(keyLabel);
      } else {
        const keyInput = document.createElement("input");
        keyInput.className =
          "w-full bg-transparent text-xs text-foreground/90 font-medium outline-none truncate hover:bg-muted/30 focus:bg-background focus:ring-1 focus:ring-ring rounded px-1 -mx-1";
        keyInput.value = key;
        keyInput.spellcheck = false;
        keyInput.setAttribute("aria-label", `Property name ${key}`);

        let currentKey = key;
        const commitKey = () => {
          const nextKey = keyInput.value.trim();
          if (!nextKey || nextKey === currentKey) {
            keyInput.value = currentKey;
            return;
          }
          if (!/^[A-Za-z_][\w.-]*$/.test(nextKey) || nextKey in meta) {
            keyInput.value = currentKey;
            return;
          }
          renamePropertyInView(view, this.sectionId, currentKey, nextKey, value as string | number | readonly string[]);
          delete meta[currentKey];
          meta[nextKey] = value;
          currentKey = nextKey;
        };

        // Native blur fires before removal; check connectivity after CodeMirror finishes updating.
        const commitKeyIfAttached = () => queueMicrotask(() => {
          if (keyInput.isConnected) commitKey();
        });
        keyInput.addEventListener("change", commitKeyIfAttached);
        keyCol.appendChild(keyInput);
        attachSuggestions(keyInput, view, root, "key", key, entries.map(([name]) => name), commitKey);
        keyInput.addEventListener("blur", commitKeyIfAttached);
        keyInput.addEventListener("keydown", (e) => {
          if (e.defaultPrevented) return;
          if (e.key === "Enter") {
            e.preventDefault();
            keyInput.blur();
          }
        });

        const focus = pendingFocus.get(view);
        if (focus?.kind === "key" && focus.key === key) {
          setTimeout(() => {
            if (!keyInput.isConnected) return;
            keyInput.focus();
            keyInput.select();
          }, 0);
          pendingFocus.delete(view);
        }
      }
      row.appendChild(keyCol);

      // Value column
      const valCol = document.createElement("div");
      valCol.className = "flex items-center flex-wrap gap-1.5 px-3 py-1.5 flex-1 min-w-0";

      const commitList = (next: string[]) => {
        meta[key] = next;
        patchPropertyInView(view, this.sectionId, [key], next.length > 0 ? next : "");
      };
      // Canonical display label for a durable reference token; null when the
      // token does not resolve (never fall back silently — unknowns stay visible).
      const refMatch = (token: string): { slug: string; label: string } | null => {
        if (!referenceProvider) return null;
        return valueKind === "effort"
          ? referenceProvider.resolveEffort(token)
          : valueKind === "equipment"
            ? referenceProvider.resolveEquipment(token)
            : null;
      };

      if (isTags || isReferenceList) {
        const chips = parseTagList(value);
        const chipIsReference = valueKind !== "tags";
        for (let idx = 0; idx < chips.length; idx++) {
          const chip = chips[idx];
          const match = chipIsReference ? refMatch(chip) : null;
          const pill = document.createElement("span");
          pill.className = match
            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-muted/60 text-foreground border border-border/60"
            : chipIsReference
              ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-destructive/10 text-destructive border border-destructive/30"
              : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 dark:border-amber-500/30";

          const pillText = document.createElement("span");
          pillText.textContent = match ? match.label : chip;
          pill.appendChild(pillText);

          if (match && referenceProvider) {
            const openLink = document.createElement("a");
            openLink.href = referenceProvider.openHref(valueKind as "effort" | "equipment", match.slug);
            openLink.title = `Open ${match.label} page`;
            openLink.setAttribute("aria-label", `Open ${match.label} page`);
            openLink.className =
              "inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground cursor-pointer";
            openLink.appendChild(createExternalIcon());
            pill.appendChild(openLink);
          }

          if (!this.readOnly) {
            const rmBtn = document.createElement("button");
            rmBtn.type = "button";
            rmBtn.setAttribute("aria-label", `Remove ${chip}`);
            rmBtn.className =
              "inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground dark:hover:text-foreground cursor-pointer";
            rmBtn.appendChild(createCloseIcon("sm"));
            rmBtn.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              commitList(chips.filter((_, i) => i !== idx));
            });
            pill.appendChild(rmBtn);
          }
          valCol.appendChild(pill);
        }

        if (!this.readOnly) {
          const chipInput = document.createElement("input");
          chipInput.className =
            "flex-1 min-w-[70px] bg-transparent text-xs text-foreground outline-none px-1 py-0.5 placeholder:text-muted-foreground/40";
          chipInput.placeholder = chips.length === 0
            ? (isReferenceList ? `Add ${valueKind === "effort" ? "effort" : "equipment"}…` : "Add tags…")
            : (isTags ? "Add tag…" : "Add…");
          chipInput.setAttribute("aria-label", isTags ? `Add tag to ${key}` : `Add to ${key}`);

          const commitNewChip = () => {
            const val = chipInput.value.trim().replace(/^,|,$/g, "");
            if (val && !chips.some((chip) => chip.toLowerCase() === val.toLowerCase())) {
              chipInput.value = "";
              pendingFocus.set(view, { kind: "tag", key });
              commitList([...chips, val]);
            }
          };
          valCol.appendChild(chipInput);
          attachSuggestions(chipInput, view, root, "value", key, chips, commitNewChip, valueKind);

          chipInput.addEventListener("keydown", (e) => {
            if (e.defaultPrevented) return;
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitNewChip();
            } else if (e.key === "Backspace" && !chipInput.value && chips.length > 0) {
              e.preventDefault();
              pendingFocus.set(view, { kind: "tag", key });
              commitList(chips.slice(0, -1));
            }
          });
          chipInput.addEventListener("blur", () => queueMicrotask(() => {
            if (chipInput.isConnected && chipInput.value.trim()) commitNewChip();
          }));

          const focus = pendingFocus.get(view);
          if (focus?.kind === "tag" && focus.key === key) {
            setTimeout(() => {
              if (chipInput.isConnected) chipInput.focus();
            }, 0);
            pendingFocus.delete(view);
          }

          // Unknown durable references stay visible with select-existing /
          // create-page actions; the authored token is never rewritten.
          if (chipIsReference && referenceProvider) {
            const unknown = chips.filter((chip) => !refMatch(chip));
            if (unknown.length > 0) {
              const diag = document.createElement("div");
              diag.setAttribute("data-testid", "editor-ref-unknown");
              diag.className = "w-full basis-full flex flex-wrap items-center gap-2 text-[10px] text-destructive";
              const label = document.createElement("span");
              label.textContent = `Unknown ${valueKind === "effort" ? "effort" : "equipment"}: ${unknown.join(", ")}`;
              diag.appendChild(label);
              const selectBtn = document.createElement("button");
              selectBtn.type = "button";
              selectBtn.textContent = "Select existing";
              selectBtn.className = "underline hover:text-foreground cursor-pointer";
              selectBtn.addEventListener("click", (e) => {
                e.preventDefault();
                chipInput.focus();
              });
              diag.appendChild(selectBtn);
              const createLink = document.createElement("a");
              createLink.href = referenceProvider.createHref(valueKind as "effort" | "equipment");
              createLink.textContent = "Create page";
              createLink.className = "underline hover:text-foreground";
              diag.appendChild(createLink);
              valCol.appendChild(diag);
            }
          }
        }
      } else if (nested) {
        const valSpan = document.createElement("span");
        valSpan.className = "text-xs text-muted-foreground/60 italic py-0.5 truncate";
        valSpan.textContent = "Nested block — edit in YAML";
        valCol.appendChild(valSpan);
      } else {
        const strVal = Array.isArray(value) ? value.join(", ") : String(value ?? "");
        if (this.readOnly) {
          const valSpan = document.createElement("span");
          valSpan.className = "text-xs text-foreground py-0.5 truncate";
          valSpan.textContent = strVal;
          valCol.appendChild(valSpan);
        } else {
          const valInput = document.createElement("input");
          valInput.className =
            "w-full bg-transparent text-xs text-foreground outline-none py-0.5 hover:bg-muted/20 focus:bg-background focus:ring-1 focus:ring-ring rounded px-1 -mx-1 transition-colors";
          valInput.value = strVal;
          valInput.spellcheck = false;
          valInput.setAttribute("aria-label", `Value for ${key}`);

          let committedVal = strVal;
          const commitVal = () => {
            const cur = valInput.value.trim();
            if (cur !== committedVal) {
              committedVal = cur;
              const num = Number(cur);
              const next = cur !== "" && !isNaN(num) ? num : cur;
              meta[key] = next;
              patchPropertyInView(view, this.sectionId, [key], next);
            }
          };

          const commitValIfAttached = () => queueMicrotask(() => {
            if (valInput.isConnected) commitVal();
          });
          valInput.addEventListener("change", commitValIfAttached);
          valCol.appendChild(valInput);
          attachSuggestions(
            valInput, view, root, "value", key, [strVal], commitVal,
            key.trim().toLowerCase() === "metrics.effort" ? "effort" : "tags",
          );
          valInput.addEventListener("blur", commitValIfAttached);
          valInput.addEventListener("keydown", (e) => {
            if (e.defaultPrevented) return;
            if (e.key === "Enter") {
              e.preventDefault();
              valInput.blur();
            }
          });

          // Note-default effort references surface shared-resolver
          // diagnostics with select-existing / create-page actions.
          if (key.trim().toLowerCase() === "metrics.effort" && referenceProvider) {
            const match = referenceProvider.resolveEffort(strVal);
            if (match) {
              const pill = document.createElement("span");
              pill.className =
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-muted/60 text-foreground border border-border/60 shrink-0";
              const pillText = document.createElement("span");
              pillText.textContent = match.label;
              pill.appendChild(pillText);

              const openLink = document.createElement("a");
              openLink.href = referenceProvider.openHref("effort", match.slug);
              openLink.title = `Open ${match.label} page`;
              openLink.setAttribute("aria-label", `Open ${match.label} page`);
              openLink.className =
                "inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground cursor-pointer";
              openLink.appendChild(createExternalIcon());
              pill.appendChild(openLink);

              valCol.insertBefore(pill, valInput);
              valInput.className =
                "flex-1 min-w-[70px] bg-transparent text-xs text-foreground outline-none py-0.5 hover:bg-muted/20 focus:bg-background focus:ring-1 focus:ring-ring rounded px-1 -mx-1 transition-colors";
            }

            const diag = renderEffortValueDiagnostics(
              referenceProvider, strVal,
              (slug) => {
                meta[key] = slug;
                patchPropertyInView(view, this.sectionId, [key], slug);
              },
            );
            if (diag) valCol.appendChild(diag);
          }
        }

        // Text-link values get a navigate-to (new tab) button.
        if (/^https?:\/\/\S+$/i.test(strVal)) {
          const openLink = document.createElement("a");
          openLink.href = strVal;
          openLink.target = "_blank";
          openLink.rel = "noopener noreferrer";
          openLink.title = strVal;
          openLink.setAttribute("aria-label", `Open ${key} in new tab`);
          openLink.className =
            "shrink-0 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer";
          openLink.appendChild(createExternalIcon());
          valCol.appendChild(openLink);
        }
      }
      row.appendChild(valCol);

      // Delete property button
      if (!this.readOnly && !nested) {
        const actionsCol = document.createElement("div");
        actionsCol.className = "flex items-center pr-2";

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.setAttribute("aria-label", `Remove property ${key}`);
        delBtn.className =
          "opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive p-1 rounded transition-opacity cursor-pointer";
        delBtn.appendChild(createCloseIcon("md"));
        delBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          delete meta[key];
          patchPropertyInView(view, this.sectionId, [key], null);
        });
        actionsCol.appendChild(delBtn);
        row.appendChild(actionsCol);
      }
    }

    // Effort definition attributes: MET / discipline / intensity tier live in
    // the nested baseAttributes block; patching each path keeps the rest of
    // the document byte-identical.
    if (docKind === "effort" && !this.readOnly) {
      box.appendChild(this.buildDefinitionRows(view, base));
    }

    if (!this.readOnly) {
      const existingTagKey = entries.find(([key]) => isTagProperty(key))?.[0];

      const actionsRow = document.createElement("div");
      actionsRow.className = "mt-2 flex items-center gap-3";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.setAttribute("aria-label", "Add property");
      addBtn.className =
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
      addBtn.appendChild(createPlusIcon());
      const addLabel = document.createElement("span");
      addLabel.textContent = "Add property";
      addBtn.appendChild(addLabel);

      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        let newKey = "property";
        let count = 1;
        while (newKey in meta) {
          count++;
          newKey = `property_${count}`;
        }
        pendingFocus.set(view, { kind: "key", key: newKey });
        patchPropertyInView(view, this.sectionId, [newKey], "");
      });
      actionsRow.appendChild(addBtn);

      // Add metric: authors the flat `metrics.*` note defaults (executable
      // keys — effort/equipment references plus numeric values) through the
      // same patch path, so note defaults stay in one source document.
      {
        const addMetricBtn = document.createElement("button");
        addMetricBtn.type = "button";
        addMetricBtn.setAttribute("aria-label", "Add metric");
        addMetricBtn.setAttribute("data-testid", "editor-add-metric-note");
        addMetricBtn.className =
          "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
        addMetricBtn.appendChild(createPlusIcon());
        const addMetricLabel = document.createElement("span");
        addMetricLabel.textContent = "Add metric";
        addMetricBtn.appendChild(addMetricLabel);
        addMetricBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const existing = root.querySelector<HTMLInputElement>("[data-frontmatter-metric-draft] input");
          if (existing) {
            existing.focus();
            return;
          }
          const draftRow = createMetricDraftRow(view, root, referenceProvider, (path, value) => {
            patchPropertyInView(view, this.sectionId, path, value);
          });
          box.appendChild(draftRow);
          draftRow.querySelector("input")?.focus();
          view.requestMeasure();
        });
        actionsRow.appendChild(addMetricBtn);
      }

      {
        const addTagBtn = document.createElement("button");
        addTagBtn.type = "button";
        addTagBtn.setAttribute("aria-label", "Add tag");
        addTagBtn.className =
          "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
        addTagBtn.appendChild(createPlusIcon());
        const addTagLabel = document.createElement("span");
        addTagLabel.textContent = "Add tag";
        addTagBtn.appendChild(addTagLabel);

        addTagBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (existingTagKey) {
            const input = Array.from(root.querySelectorAll("input")).find((element) => element.getAttribute("aria-label") === `Add tag to ${existingTagKey}`);
            input?.focus();
            return;
          }
          const existingDraft = root.querySelector<HTMLInputElement>("[data-frontmatter-tag-draft] input");
          if (existingDraft) {
            existingDraft.focus();
            return;
          }
          const draftRow = createTagDraftRow(view, root, "tags", (val) => {
            pendingFocus.set(view, { kind: "tag", key: "tags" });
            patchPropertyInView(view, this.sectionId, ["tags"], [val]);
          });
          box.appendChild(draftRow);
          draftRow.querySelector("input")?.focus();
          view.requestMeasure();
        });
        actionsRow.appendChild(addTagBtn);
      }

      {
        const editYamlBtn = document.createElement("button");
        editYamlBtn.type = "button";
        editYamlBtn.setAttribute("aria-label", "Edit YAML");
        editYamlBtn.setAttribute("data-testid", "editor-property-edit-yaml");
        editYamlBtn.className =
          "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
        const editYamlLabel = document.createElement("span");
        editYamlLabel.textContent = "Edit YAML";
        editYamlBtn.appendChild(editYamlLabel);
        editYamlBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const { sections: currentSections } = view.state.field(sectionField);
          const section =
            currentSections.find((s) => s.id === this.sectionId && s.type === "frontmatter") ||
            currentSections.find((s) => s.type === "frontmatter");
          if (!section) return;
          view.dispatch({ selection: { anchor: section.contentFrom ?? section.from }, scrollIntoView: true });
          view.focus();
        });
        actionsRow.appendChild(editYamlBtn);
      }

      root.appendChild(actionsRow);
    }

    return root;
  }

  /**
   * Effort-definition attribute rows (MET / discipline / intensity tier).
   * Values live in the nested baseAttributes block; each edit patches that
   * one path, so unknown sibling keys and comments elsewhere survive.
   */
  private buildDefinitionRows(
    view: EditorView,
    base: { met?: string; discipline?: string; intensityTier?: string },
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-frontmatter-definition", "true");
    wrap.className = "border-t border-dashed border-border/60";

    const header = document.createElement("div");
    header.className = "px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
    header.textContent = "Definition";
    wrap.appendChild(header);

    const commitField = (field: "met" | "discipline" | "intensityTier", raw: string) => {
      if (field === "met") {
        const num = Number(raw);
        patchPropertyInView(view, this.sectionId, ["baseAttributes", "met"], raw !== "" && !Number.isNaN(num) ? num : null);
        return;
      }
      patchPropertyInView(view, this.sectionId, ["baseAttributes", field], raw === "" ? null : raw);
    };

    const fieldRow = (label: string, child: HTMLElement) => {
      const row = document.createElement("label");
      row.className =
        "flex items-center gap-2 px-3 py-1.5 min-h-[34px] border-b border-dashed border-border/60 last:border-b-0 max-[479px]:flex-col max-[479px]:items-stretch";
      const name = document.createElement("span");
      name.className = "w-28 shrink-0 text-muted-foreground";
      name.textContent = label;
      row.appendChild(name);
      child.className = "flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none py-0.5";
      row.appendChild(child);
      wrap.appendChild(row);
    };

    const met = document.createElement("input");
    met.type = "number";
    met.step = "0.1";
    met.inputMode = "decimal";
    met.value = base.met ?? "";
    met.setAttribute("aria-label", "MET value");
    met.addEventListener("change", () => queueMicrotask(() => {
      if (met.isConnected) commitField("met", met.value.trim());
    }));
    fieldRow("MET", met);

    const discipline = document.createElement("select");
    discipline.setAttribute("aria-label", "Discipline");
    discipline.className =
      "flex-1 min-w-0 rounded-md border border-input bg-background px-1.5 text-[11px] text-muted-foreground outline-none";
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "Unset";
    discipline.appendChild(unset);
    for (const option of EFFORT_DISCIPLINES) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      discipline.appendChild(opt);
    }
    discipline.value = base.discipline ?? "";
    discipline.addEventListener("change", () => commitField("discipline", discipline.value));
    fieldRow("Discipline", discipline);

    const tier = document.createElement("select");
    tier.setAttribute("aria-label", "Intensity tier");
    tier.className =
      "flex-1 min-w-0 rounded-md border border-input bg-background px-1.5 text-[11px] text-muted-foreground outline-none";
    const tierUnset = document.createElement("option");
    tierUnset.value = "";
    tierUnset.textContent = "Unset";
    tier.appendChild(tierUnset);
    for (const option of ["low", "moderate", "high"]) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      tier.appendChild(opt);
    }
    tier.value = base.intensityTier ?? "";
    tier.addEventListener("change", () => commitField("intensityTier", tier.value));
    fieldRow("Intensity tier", tier);

    return wrap;
  }

  destroy(dom: HTMLElement): void {
    widgetCleanup.get(dom)?.forEach((close) => close());
    widgetCleanup.delete(dom);
  }
}

class EmptyFrontmatterWidget extends WidgetType {
  eq(_other: EmptyFrontmatterWidget): boolean {
    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-frontmatter-preview py-2 font-sans select-none";

    const heading = document.createElement("div");
    heading.className = "text-xs font-medium text-muted-foreground mb-1.5 px-0.5";
    heading.textContent = "Properties";
    root.appendChild(heading);

    const actionsRow = document.createElement("div");
    actionsRow.className = "flex items-center gap-3";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.setAttribute("aria-label", "Add property");
    addBtn.className =
      "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
    addBtn.appendChild(createPlusIcon());
    const addLabel = document.createElement("span");
    addLabel.textContent = "Add property";
    addBtn.appendChild(addLabel);

    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pendingFocus.set(view, { kind: "key", key: "property" });
      patchPropertyInView(view, "new", ["property"], "");
    });
    actionsRow.appendChild(addBtn);

    const addTagBtn = document.createElement("button");
    addTagBtn.type = "button";
    addTagBtn.setAttribute("aria-label", "Add tag");
    addTagBtn.className =
      "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-1 py-1 cursor-pointer transition-colors select-none";
    addTagBtn.appendChild(createPlusIcon());
    const addTagLabel = document.createElement("span");
    addTagLabel.textContent = "Add tag";
    addTagBtn.appendChild(addTagLabel);

    addTagBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const existingDraft = root.querySelector<HTMLInputElement>("[data-frontmatter-tag-draft] input");
      if (existingDraft) {
        existingDraft.focus();
        return;
      }
      const draftRow = createTagDraftRow(view, root, "tags", (val) => {
        pendingFocus.set(view, { kind: "tag", key: "tags" });
        patchPropertyInView(view, "new", ["tags"], [val]);
      });
      root.appendChild(draftRow);
      draftRow.querySelector("input")?.focus();
      view.requestMeasure();
    });
    actionsRow.appendChild(addTagBtn);

    root.appendChild(actionsRow);
    return root;
  }
}

function buildFrontmatterDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections } = state.field(sectionField);

  const visible = state.facet(frontmatterVisibility);
  let hasFrontmatter = false;
  for (const section of sections) {
    if (section.type !== "frontmatter") continue;
    hasFrontmatter = true;

    if (!visible) {
      const to = section.to < state.doc.length ? section.to + 1 : section.to;
      builder.add(section.from, to, Decoration.replace({ block: true }));
      continue;
    }

    // While the selection intersects the section, reveal the raw YAML so the
    // source (and its completions) stay editable; the widget returns on exit.
    const selected = !state.readOnly && state.selection.ranges.some((range) => range.from < section.to && range.to > section.from);
    if (selected) continue;

    const rawContent = state.doc.sliceString(section.from, section.to);
    builder.add(
      section.from,
      section.to,
      Decoration.replace({
        widget: new DefaultFrontmatterWidget(section.id, rawContent, state.readOnly),
        block: true,
      }),
    );
  }

  if (visible && !hasFrontmatter && !state.readOnly) {
    builder.add(
      0,
      0,
      Decoration.widget({
        widget: new EmptyFrontmatterWidget(),
        side: -1,
        block: true,
      }),
    );
  }

  return builder.finish();
}

export const frontmatterPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterDecos(state);
  },
  update(deco, tr) {
    if (tr.docChanged || tr.reconfigured || tr.selection || tr.effects.some((e) => e.is(referenceIndexReload))) {
      return buildFrontmatterDecos(tr.state);
    }
    return deco;
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) =>
      view.state.facet(frontmatterVisibility) ? Decoration.none : view.state.field(f),
    ),
  ],
});

export const frontmatterPreview: Extension = [frontmatterPreviewField];
