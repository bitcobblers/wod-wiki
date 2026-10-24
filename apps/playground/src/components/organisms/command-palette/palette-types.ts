import type React from 'react';
import type { WqlExecutor } from '@bitcobblers/wod-wiki-ui';

/**
 * WQL mode for the palette (issue #834, decision #828): the plain text input
 * is replaced by the embedded WqlComposer, and sources receive the composed
 * WQL string instead of fuzzy text.
 */
export interface PaletteWqlConfig {
  /**
   * Palette-specific seed query for the composer (e.g. its default target /
   * window). Defaults to the composer's own default (:note last 2w).
   */
  initialQuery?: string;
  /** Extra content rendered inside the composer bar, after the add-filter menu. */
  customSlots?: React.ReactNode;
  /** Render the composer's diagnostics strip (badge, AST summary, stage counts). Default true. */
  showDiagnostics?: boolean;
  /** Execute for live stage counts in the diagnostics strip — dispatch on
   * query kind, e.g. `(ast) => isFindQuery(ast) ? queryService.runFind(ast)
   * : queryService.runQuery(ast.raw)`. When omitted, the strip omits counts
   * and no query is executed. */
  execute?: WqlExecutor;
  /**
   * Picker favorites (e.g. the /palette route config's stored options) —
   * sort shared-picker choices to the top without excluding valid rows.
   */
  preferredChoices?: readonly string[];
  /**
   * Query-crafting mode (header query bar): when provided, the palette
   * renders an "Apply query" action (and Enter applies) that receives the
   * composed WQL and closes the palette — the caller writes the query back
   * to its own state instead of navigating.
   */
  onApply?: (wql: string) => void;
  /**
   * The surface's own settings, rendered INSIDE the palette (not as a nested
   * modal — the palette is a focus-trapped dialog, so a second overlay on
   * top of it would be unreachable). The host supplies the panel content;
   * the palette owns the open state and renders the gear that toggles it.
   */
  settings?: PaletteSettingsSlot;
}

/** The palette's per-surface settings affordance. */
export interface PaletteSettingsSlot {
  /** The panel content, shown in the palette body while open. */
  panel: React.ReactNode;
  /** Accessible label for the gear that opens the panel. */
  label?: string;
}

/**
 * The request a caller passes to `usePaletteStore.open()`.
 * Sources drive the search; the caller handles the result.
 */
export interface PaletteRequest {
  placeholder?: string;
  initialQuery?: string;
  /** Optional contextual UI rendered below the search input (e.g. breadcrumbs, segment display). */
  header?: React.ReactNode;
  /** WQL mode: embed the WqlComposer and feed composed WQL to the sources. */
  wql?: PaletteWqlConfig;
  sources: PaletteDataSource[];
}

/**
 * Per-search context the palette host supplies alongside the draft.
 */
export interface PaletteSearchContext {
  /**
   * The composer's live scope: the last valid find draft emitted this
   * session — updated synchronously with every composer emission, never
   * debounce-late. Sources that must stay inside the selected scope merge
   * the draft into it; absent, they fall back to their own defaults.
   */
  scopeWql?: string;
}

/**
 * A single pluggable search backend.
 * Pure async function — no side effects, no navigation.
 */
export interface PaletteDataSource {
  id: string;
  /** Displayed as a group heading above this source's results. */
  label?: string;
  search: (query: string, context?: PaletteSearchContext) => PaletteItem[] | Promise<PaletteItem[]>;
}

/** A single result row returned by a PaletteDataSource. */
export interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  /** Used as group header in the results list. */
  category?: string;
  type?: 'journal-entry' | 'collection' | 'workout' | 'action' | 'statement-part' | 'route' | 'entry';
  /** Caller-defined; returned as-is in PaletteResponse. */
  payload?: unknown;
}

/** What the palette resolves with when the user acts or dismisses. */
export type PaletteResponse =
  | { dismissed: true }
  | { dismissed: false; item: PaletteItem };
