/**
 * MetricInlinePanel
 *
 * React overlay that appears directly below the cursor line when the cursor
 * is inside a WOD code fence. Shows a compact row of metric chips with:
 *   - Color-coded labels matching the underline decorations
 *   - Metric type icon + label + value
 *   - Per-line execution history (if available)
 *   - Action buttons passed via the `commands` prop
 *
 * Positioning: uses CM6's `view.coordsAtPos()` to get the bottom of the
 * cursor line in viewport coordinates, then uses `position: fixed` so no
 * scroll-offset math is needed.
 *
 * The panel hides automatically when the cursor leaves a WOD section.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import { getReferenceMetadata, getTagReference, type TagReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import { getCursorFocusState, type CursorFocusState } from '@/app/editor/cursorFocusExtension';
import { frontmatterReferenceIndex } from '@bitcobblers/wod-wiki-ui/extensions';
import { presentThemedGroup } from "@/components/metrics/presentation";
import type { SegmentType } from "@/components/organisms/command-palette/segmentSources";
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store';
import {
  referencePaletteSource,
  parseLineRefs,
  buildLineWithRefs,
  createInlineEffortFromToken,
  addInlineEffortAlias,
  createInlineEquipmentFromToken,
  createInlineTagFromSlug,
} from '@/app/editor/noteEditorServices';
import { catalogueReload } from '@/app/editor/catalogueReload';
import { cn } from "@/lib/utils";
import type { ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";

// ── Metric display config ────────────────────────────────────────────

interface MetricStyle {
  label: string;
  icon: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
}

const METRIC_STYLES: Partial<Record<string, MetricStyle>> = {
  [MetricType.Duration]: {
    label: "Timer", icon: "⏱",
    textClass: "text-metric-time",
    bgClass:   "bg-metric-time/10",
    borderClass: "border-metric-time/30",
  },
  [MetricType.Rep]: {
    label: "Reps", icon: "✕",
    textClass: "text-metric-rep",
    bgClass:   "bg-metric-rep/10",
    borderClass: "border-metric-rep/30",
  },
  [MetricType.Effort]: {
    label: "Exercise", icon: "🏋",
    textClass: "text-metric-effort",
    bgClass:   "bg-metric-effort/10",
    borderClass: "border-metric-effort/30",
  },
  [MetricType.Rounds]: {
    label: "Rounds", icon: "↻",
    textClass: "text-metric-rounds",
    bgClass:   "bg-metric-rounds/10",
    borderClass: "border-metric-rounds/30",
  },
  [MetricType.Distance]: {
    label: "Distance", icon: "📏",
    textClass: "text-metric-distance",
    bgClass:   "bg-metric-distance/10",
    borderClass: "border-metric-distance/30",
  },
  [MetricType.Resistance]: {
    label: "Weight", icon: "⚖",
    textClass: "text-metric-resistance",
    bgClass:   "bg-metric-resistance/10",
    borderClass: "border-metric-resistance/30",
  },
  [MetricType.Equipment]: {
    label: "Equipment", icon: "🧰",
    textClass: "text-metric-equipment",
    bgClass:   "bg-metric-equipment/10",
    borderClass: "border-metric-equipment/30",
  },
  [MetricType.Action]: {
    label: "Action", icon: "⚡",
    textClass: "text-metric-action",
    bgClass:   "bg-metric-action/10",
    borderClass: "border-metric-action/30",
  },
  [MetricType.Label]: {
    label: "Label", icon: "🏷",
    textClass: "text-muted-foreground",
    bgClass:   "bg-muted/30",
    borderClass: "border-border/40",
  },
};

// ── Metric chip ───────────────────────────────────────────────────────

/** Metric types that map onto statement-builder segments (clickable). */
const SEGMENT_FOR_METRIC: Partial<Record<string, SegmentType>> = {
  [MetricType.Rep]:        'reps',
  [MetricType.Effort]:     'movement',
  [MetricType.Resistance]: 'weight',
};

const MetricChip: React.FC<{
  metric: IMetric;
  tooltip?: string;
  isFocused: boolean;
  onClick?: () => void;
}> = ({ metric, tooltip, isFocused, onClick }) => {
  const style = METRIC_STYLES[metric.type as string];
  const isHint = metric.type === MetricType.Hint;
  const displayVal =
    metric.name ?? metric.image ?? (metric.value !== undefined ? String(metric.value) : "");
  const label = style?.label ?? String(metric.type);

  return (
    <span
      title={tooltip}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] leading-none font-medium whitespace-nowrap",
        "pointer-events-auto transition-opacity hover:opacity-80",
        style?.bgClass ?? "bg-muted/30",
        style?.textClass ?? "text-muted-foreground",
        style?.borderClass ?? "border-border/40",
        onClick && "cursor-pointer",
        isFocused && "font-bold shadow-xs",
      )}
    >
      <span>{isHint ? metric.icon : (style?.icon ?? "•")}</span>
      {!isHint && <span className="sr-only">{label}</span>}
      {!isHint && (
        <span className="font-semibold">{displayVal || label}</span>
      )}
    </span>
  );
};

// ── Panel position ────────────────────────────────────────────────────

/** Canonical references attached by the shared resolver (parser metadata). */
interface ReferenceRefShape {
  kind: 'effort' | 'equipment';
  slug: string;
  label: string;
  matchedAlias?: string;
}

/** Resolver diagnostics for authored references (unknown/ambiguous/conflicting). */
interface DiagnosticShape {
  reason: string;
  message: string;
  token?: string;
  candidates?: readonly string[];
}

function metricMetadata(metric: IMetric): { refs: ReferenceRefShape[]; diagnostics: DiagnosticShape[] } {
  const reference = getReferenceMetadata(metric.metadata);
  return { refs: reference?.refs ?? [], diagnostics: reference?.diagnostics ?? [] };
}

interface PanelPosition {
  top: number;
  left: number;
  maxWidth: number;
  belowLine: boolean;
}

function computePosition(
  view: EditorView,
  focus: CursorFocusState,
): PanelPosition | null {
  try {
    const lineCoords = view.coordsAtPos(focus.lineFrom);
    if (!lineCoords) return null;
    const endCoords = typeof focus.lineTo === "number" ? (view.coordsAtPos(focus.lineTo) ?? lineCoords) : lineCoords;
    const editorRect = view.dom?.getBoundingClientRect?.() ?? { top: 0, left: 0, width: 600 };
    const contentRect = view.contentDOM?.getBoundingClientRect?.() ?? { left: 0, width: 600 };

    const contentLeft = Math.max(0, contentRect.left - editorRect.left);
    const contentRight = contentLeft + Math.max(240, contentRect.width);
    const endLeft = endCoords.left - editorRect.left + 12;
    const roomAtEnd = contentRight - endLeft;

    // Place inline at the end of the active row when at least 180px of horizontal
    // space remains; otherwise wrap cleanly beneath the row (mobile / long lines).
    if (roomAtEnd >= 180) {
      const rowTop = typeof endCoords.top === "number" ? endCoords.top : endCoords.bottom - 20;
      return {
        top: Math.max(0, rowTop - editorRect.top - 1),
        left: endLeft,
        maxWidth: roomAtEnd - 4,
        belowLine: false,
      };
    }

    return {
      top: endCoords.bottom - editorRect.top + 3,
      left: contentLeft,
      maxWidth: Math.max(220, contentRect.width),
      belowLine: true,
    };
  } catch {
    return null;
  }
}

// ── Panel component ───────────────────────────────────────────────────

export interface MetricInlinePanelProps {
  /** Live editor view reference. */
  view: EditorView | null;
  /** Increment when cursor line changes (drives re-render). */
  cursorVersion: number;
  /** Optional override of getCursorFocusState for testing. */
  getCursorFocusState?: typeof getCursorFocusState;
  /** Commands available on WOD blocks (forwarded to action buttons). */
  commands?: ScriptCommand[];
  /** Note ID (forwarded to commands if needed). */
  noteId?: string;
}

export const MetricInlinePanel: React.FC<MetricInlinePanelProps> = ({
  view,
  cursorVersion,
  getCursorFocusState: getCursorFocusStateProp,
}) => {
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const [focus, setFocus] = useState<CursorFocusState | null>(null);
  const [openDiagKey, setOpenDiagKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Recompute focus state and position whenever cursor version changes
  const update = useCallback(() => {
    if (!view) {
      setFocus(null);
      setPos(null);
      return;
    }

    const nextFocus = (getCursorFocusStateProp ?? getCursorFocusState)(view.state);
    setFocus(nextFocus);
    setPos(nextFocus ? computePosition(view, nextFocus) : null);
  }, [view, getCursorFocusStateProp]);

  useEffect(() => {
    update();
  }, [update, cursorVersion]);

  // Also recompute on window scroll/resize to keep position accurate
  useEffect(() => {
    if (!view) return;
    const handler = () => update();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler, true);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler, true);
    };
  }, [view, update]);

  // Don't render if cursor is outside a WOD section or autocomplete menu is open
  const isAutocompleteOpen = view?.state && typeof view.state.field === 'function'
    ? completionStatus(view.state) === 'active'
    : false;
  if (!pos || !focus?.section || isAutocompleteOpen) return null;

  const lineStatements = focus.allStatements?.filter(s => s.meta?.line === focus.cursorLine - focus.section.startLine)
    ?? (focus.statement ? [focus.statement] : []);
  // Filter out Effort/Equipment metrics that already resolved to canonical
  // `refs` chips or `diagnostics` chips so the pill never shows duplicate
  // Exercise + Ref + Diagnostic items for the same token.
  const visibleMetrics = lineStatements.flatMap(s => s.metrics.toArray()).filter((m) => {
    if (m.type === MetricType.Sound || m.type === MetricType.System) return false;
    if (m.type === MetricType.Hint && !m.icon) return false;
    if (
      m.type === MetricType.Custom &&
      typeof m.value === "string" &&
      /^#[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(m.value.trim())
    ) {
      return false;
    }
    if (m.type === MetricType.Effort || m.type === MetricType.Equipment) {
      const meta = metricMetadata(m);
      if (meta.refs.length > 0 || meta.diagnostics.length > 0) return false;
    }
    return true;
  });
  const tokens = presentThemedGroup(visibleMetrics, 'runtime-badge');

  // Canonical refs + resolver diagnostics straight off the parser-attached
  // metadata — the panel never re-resolves labels from display text.
  const lineMetrics = lineStatements.flatMap(s => s.metrics.toArray());
  const seenRefKeys: string[] = [];
  const refs: ReferenceRefShape[] = [];
  const diagnostics: DiagnosticShape[] = [];
  for (const metric of lineMetrics) {
    const metadata = metricMetadata(metric);
    for (const ref of metadata.refs) {
      const refKey = `${ref.kind}:${ref.slug}`;
      if (!seenRefKeys.includes(refKey)) {
        seenRefKeys.push(refKey);
        refs.push(ref);
      }
    }
    diagnostics.push(...metadata.diagnostics);
  }
  // The tag references the line carries — what a `#slug` brought, and the
  // sound profile a `#sound-` reference names.
  const tagRefs: TagReferenceMetadata[] = [];
  const unresolvedTagSlugs: string[] = [];
  for (const metric of lineMetrics) {
    const reference = getTagReference(metric.metadata);
    if (reference) {
      if (!tagRefs.some(existing => existing.slug === reference.slug)) {
        tagRefs.push(reference);
      }
      continue;
    }
    if (
      metric.type === MetricType.Custom &&
      typeof metric.value === "string" &&
      /^#[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(metric.value.trim())
    ) {
      const slug = metric.value.trim().slice(1);
      if (!unresolvedTagSlugs.includes(slug)) unresolvedTagSlugs.push(slug);
    }
  }
  const referenceProvider = typeof view?.state?.facet === 'function' ? (view.state.facet(frontmatterReferenceIndex)?.() ?? null) : null;
  const lineRefs = typeof view?.state?.doc?.sliceString === 'function' ? parseLineRefs(view.state.doc.sliceString(focus.lineFrom, focus.lineTo)) : null;

  /** Resolve which catalog a diagnostic repair should offer. */
  const diagnosticKind = (diag: DiagnosticShape): 'effort' | 'equipment' => {
    if (diag.reason === 'conflict' || diag.reason.endsWith('equipment')) return 'equipment';
    if (diag.reason === 'invalid-explicit') {
      if (diag.token && lineRefs?.equipment.includes(diag.token)) return 'equipment';
    }
    return 'effort';
  };

  /** Palette payloads are author-validated slugs; anything else is refused. */
  const payloadSlug = (payload: unknown): string | null =>
    typeof payload === 'string' && payload.trim() ? payload : null;

  const changeRefSource = async (kind: 'effort' | 'equipment') => {
    if (!view) return;
    const lineText = view.state.doc.sliceString(focus.lineFrom, focus.lineTo);
    const palette = usePaletteStore.getState();
    if (kind === 'effort') {
      const result = await palette.open({ placeholder: 'Change effort…', sources: [referencePaletteSource('effort')] });
      if (result.dismissed) return;
      const slug = payloadSlug(result.item.payload);
      if (!slug) return;
      view.dispatch({
        changes: { from: focus.lineFrom, to: focus.lineTo, insert: buildLineWithRefs(lineText, { effort: slug }) },
      });
      return;
    }
    const equipment = [...(lineRefs?.equipment ?? [])];
    for (;;) {
      const result = await palette.open({
        placeholder: equipment.length > 0 ? 'Add equipment (Esc to finish)…' : 'Set equipment…',
        sources: [referencePaletteSource('equipment')],
      });
      if (result.dismissed) break;
      const slug = payloadSlug(result.item.payload);
      if (slug && !equipment.includes(slug)) equipment.push(slug);
    }
    if ((lineRefs?.jsonFrom ?? -1) >= 0 || equipment.length > 0) {
      view.dispatch({
        changes: { from: focus.lineFrom, to: focus.lineTo, insert: buildLineWithRefs(lineText, { equipment }) },
      });
    }
  };

  // Add metric on the focused line: explicit refs land as quoted JSON
  // (effort string, equipment array) merged into the statement's JSON
  // suffix, preserving existing refs and unrelated metric keys.
  const addLineMetric = async () => {
    if (!view) return;
    const lineText = view.state.doc.sliceString(focus.lineFrom, focus.lineTo);
    const palette = usePaletteStore.getState();
    let effort: string | undefined;
    const effortResult = await palette.open({ placeholder: 'Add effort (Esc to skip)…', sources: [referencePaletteSource('effort')] });
    if (!effortResult.dismissed) effort = payloadSlug(effortResult.item.payload) ?? undefined;
    const equipment: string[] = [];
    for (;;) {
      const result = await palette.open({ placeholder: 'Add equipment (Esc to finish)…', sources: [referencePaletteSource('equipment')] });
      if (result.dismissed) break;
      const slug = payloadSlug(result.item.payload);
      if (slug && !equipment.includes(slug)) equipment.push(slug);
    }
    if (!effort && equipment.length === 0) return;
    view.dispatch({
      changes: { from: focus.lineFrom, to: focus.lineTo, insert: buildLineWithRefs(lineText, { effort, equipment }) },
    });
  };

  const dispatchReload = () => {
    if (view && typeof view.dispatch === 'function') {
      view.dispatch({ effects: [catalogueReload.of(null)] });
    }
    update();
  };

  const repairDiagnostic = async (diag: DiagnosticShape) => {
    if (!view || !diag.token) return;
    const kind = diagnosticKind(diag);
    const palette = usePaletteStore.getState();
    const result = await palette.open({
      placeholder: `Replace “${diag.token}”…`,
      sources: [referencePaletteSource(kind, diag.candidates)],
    });
    if (result.dismissed) return;
    const slug = payloadSlug((result as { item: { payload?: unknown } }).item.payload);
    if (!slug) return;
    const lineText = view.state.doc.sliceString(focus.lineFrom, focus.lineTo);
    const tokenIndex = lineText.indexOf(diag.token);
    if (tokenIndex < 0) return;
    view.dispatch({
      changes: {
        from: focus.lineFrom + tokenIndex,
        to: focus.lineFrom + tokenIndex + diag.token.length,
        insert: slug,
      },
    });
  };

  const handleCreateFromToken = async (kind: 'effort' | 'equipment', token: string) => {
    if (!token.trim()) return;
    if (kind === 'effort') {
      await createInlineEffortFromToken(token);
    } else {
      await createInlineEquipmentFromToken(token);
    }
    dispatchReload();
  };

  const handleAddAliasFromToken = async (token: string) => {
    if (!token.trim()) return;
    const palette = usePaletteStore.getState();
    const result = await palette.open({
      placeholder: `Link “${token}” as alias to effort…`,
      sources: [referencePaletteSource('effort')],
    });
    if (result.dismissed) return;
    const targetSlug = payloadSlug((result as { item: { payload?: unknown } }).item.payload);
    if (!targetSlug) return;
    await addInlineEffortAlias(targetSlug, token);
    dispatchReload();
  };

  const handleCreateTag = async (slug: string) => {
    if (!slug.trim()) return;
    await createInlineTagFromSlug(slug);
    dispatchReload();
  };

  const handleChipClick = (metric: IMetric) => {
    const segment = SEGMENT_FOR_METRIC[metric.type as string];
    if (!segment || !view) return;
    // Explicit JSON refs are edited as refs; plain statement text still goes
    // through the statement builder (which owns the phrase segments).
    const kind: 'effort' | 'equipment' | null =
      metric.type === MetricType.Effort ? 'effort'
      : metric.type === MetricType.Equipment ? 'equipment'
      : null;
    if (kind && lineRefs?.jsonFrom !== undefined && lineRefs.jsonFrom >= 0) {
      void changeRefSource(kind);
      return;
    }
    import("@/components/Editor/services/statementBuilderFlow").then(
      ({ runStatementBuilderFlow }) => {
        runStatementBuilderFlow(focus, view, segment);
      }
    );
  };

  return (
    <div
      ref={panelRef}
      className={cn(
        "cm-metric-inline-panel",
        "absolute z-40 pointer-events-auto",
        "inline-flex items-center gap-1 px-1.5 py-0.5 min-h-[22px]",
        pos.belowLine
          ? "bg-popover/95 backdrop-blur-md border border-border/70 rounded-md shadow-sm"
          : "bg-transparent",
        "transition-opacity duration-100 max-w-full",
      )}
      style={{
        top: pos.top,
        left: pos.left,
        maxWidth: pos.maxWidth,
      }}
      aria-live="polite"
      aria-label="Metric inline panel"
    >
      {visibleMetrics.length > 0 || refs.length > 0 || tagRefs.length > 0 || diagnostics.length > 0 || unresolvedTagSlugs.length > 0 ? (
        <div className="flex items-center gap-1 flex-wrap">
            {visibleMetrics.map((metric, i) => (
              <MetricChip
                key={`${metric.type}-${i}`}
                metric={metric}
                tooltip={metric.type === MetricType.Hint
                  ? String(metric.value ?? '')
                  : tokens[i]?.tooltip}
                isFocused={focus.focusedMetric === metric}
                onClick={SEGMENT_FOR_METRIC[metric.type as string]
                  ? () => handleChipClick(metric)
                  : undefined}
              />
            ))}

            {/* Canonical resolved references — click changes the source,
                ↗ opens the effort/equipment page. */}
            {refs.map((ref) => {
              const isFocusedRef =
                (ref.kind === 'effort' && focus.focusedMetric?.type === MetricType.Effort) ||
                (ref.kind === 'equipment' && focus.focusedMetric?.type === MetricType.Equipment);
              return (
                <span
                  key={`${ref.kind}:${ref.slug}`}
                  title={`${ref.kind === 'effort' ? 'Effort' : 'Equipment'}: ${ref.label} (${ref.slug})${ref.matchedAlias ? ` · matched alias "${ref.matchedAlias}"` : ''} · click to change`}
                  onClick={() => void changeRefSource(ref.kind)}
                  className={cn(
                    "pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] leading-none font-medium cursor-pointer hover:opacity-80 whitespace-nowrap",
                    ref.kind === 'effort'
                      ? "bg-metric-effort/10 text-metric-effort border-metric-effort/30"
                      : "bg-metric-equipment/10 text-metric-equipment border-metric-equipment/30",
                    isFocusedRef && "font-bold shadow-xs",
                  )}
                >
                  <span>{ref.kind === 'effort' ? '🏋' : '🧰'}</span>
                  <span className="sr-only">{ref.kind === 'effort' ? 'Exercise' : 'Equipment'}</span>
                  <span className="font-semibold">{ref.label}</span>
                  {referenceProvider && (
                    <a
                      href={referenceProvider.openHref(ref.kind, ref.slug)}
                      title={`Open ${ref.label} page`}
                      aria-label={`Open ${ref.label} page`}
                      className="opacity-70 hover:opacity-100 ml-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                </span>
              );
            })}

            {tagRefs.map((ref) => (
              <span
                key={`tag:${ref.slug}`}
                title={ref.soundProfileId
                  ? `Tag ${ref.label} · names the ${ref.soundProfileId} sound profile`
                  : `Tag ${ref.label}`}
                className="pointer-events-auto inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] leading-none font-medium bg-primary/10 text-primary border-primary/30 whitespace-nowrap"
              >
                <span>#</span>
                <span className="font-semibold font-mono">{ref.label}</span>
                {referenceProvider && (
                  <a
                    href={referenceProvider.openHref('tag', ref.slug)}
                    title={`Open the ${ref.label} tag`}
                    aria-label={`Open the ${ref.label} tag`}
                    className="opacity-70 hover:opacity-100 ml-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                )}
              </span>
            ))}

            {lineRefs?.malformed && (
              <span
                data-testid="editor-ref-unknown"
                title="Reference JSON on this line does not parse — fix it in the raw text."
                className="pointer-events-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium bg-destructive/10 text-destructive border-destructive/30"
              >
                <span>⚠</span>
                <span>Malformed reference JSON</span>
              </span>
            )}

            {unresolvedTagSlugs.map((slug) => (
              <span
                key={`unresolved-tag:${slug}`}
                data-testid="editor-tag-unknown"
                title={`Unknown tag #${slug} — click to create`}
                className="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-dashed text-[10px] leading-none font-medium bg-warning/10 text-warning border-warning/40 whitespace-nowrap"
              >
                <span className="font-mono font-semibold">#{slug}</span>
                <button
                  type="button"
                  data-testid="editor-create-tag-inline"
                  className="underline cursor-pointer hover:text-foreground font-semibold ml-0.5"
                  onClick={() => void handleCreateTag(slug)}
                >
                  + Tag
                </button>
              </span>
            ))}

            {diagnostics.map((diag, i) => {
              const diagKind = diagnosticKind(diag);
              const token = diag.token?.trim() ?? '';
              const isUnknownEffort = diag.reason === 'unknown-effort';
              const diagKey = `${diag.reason}-${token || i}`;
              const isExpanded = openDiagKey === diagKey || openDiagKey === 'all';
              return (
                <span
                  key={diagKey}
                  data-testid="editor-ref-unknown"
                  title={diag.message}
                  onClick={() => {
                    if (!isExpanded) setOpenDiagKey(diagKey);
                  }}
                  className={cn(
                    "pointer-events-auto inline-flex flex-wrap items-center gap-1.5 px-1.5 py-0.5 rounded-xl border border-dashed text-[10px] leading-tight font-medium bg-warning/10 text-warning border-warning/40 max-w-full",
                    !isExpanded && "rounded-full whitespace-nowrap cursor-pointer hover:bg-warning/15",
                  )}
                >
                  <span>?</span>
                  <span className="font-semibold">{diag.token ?? diag.reason}</span>
                  {!isExpanded ? (
                    <button
                      type="button"
                      data-testid="editor-define-token"
                      className="underline cursor-pointer hover:text-foreground font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDiagKey(diagKey);
                      }}
                    >
                      Define ▾
                    </button>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1.5 pl-1 border-l border-warning/30">
                      {token && (
                        <button
                          type="button"
                          data-testid={`editor-create-${diagKind}-inline`}
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCreateFromToken(diagKind, token);
                          }}
                        >
                          + {diagKind === 'effort' ? 'Effort' : 'Equipment'}
                        </button>
                      )}
                      {token && isUnknownEffort && (
                        <button
                          type="button"
                          data-testid="editor-link-alias-inline"
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAddAliasFromToken(token);
                          }}
                        >
                          + Alias
                        </button>
                      )}
                      {token && isUnknownEffort && (
                        <button
                          type="button"
                          data-testid="editor-create-equipment-from-token"
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCreateFromToken('equipment', token);
                          }}
                        >
                          + Equipment
                        </button>
                      )}
                      <button
                        type="button"
                        className="underline cursor-pointer hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          void repairDiagnostic(diag);
                        }}
                      >
                        Select existing
                      </button>
                      {referenceProvider && (
                        <a
                          href={referenceProvider.createHref(diagKind)}
                          className="underline hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Create page
                        </a>
                      )}
                    </span>
                  )}
                </span>
              );
            })}

            <button
              type="button"
              data-testid="editor-add-metric-line"
              title="Add effort/equipment reference to this line"
              onClick={() => void addLineMetric()}
              className="pointer-events-auto inline-flex items-center px-1.5 py-0.5 rounded-full border border-dashed border-border/60 text-[10px] leading-none text-muted-foreground hover:text-foreground hover:border-primary/50 cursor-pointer whitespace-nowrap"
            >
              + Metric
            </button>
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground/60 italic select-none">
          No metrics on this line
        </span>
      )}
    </div>
  );
};
