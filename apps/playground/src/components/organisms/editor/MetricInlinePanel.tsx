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
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import { getReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import { getCursorFocusState, type CursorFocusState } from '@/app/editor/cursorFocusExtension';
import { frontmatterReferenceIndex } from '@bitcobblers/wod-wiki-ui/extensions';
import { presentThemedGroup } from "@/components/metrics/presentation";
import type { SegmentType } from "@/components/organisms/command-palette/segmentSources";
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store';
import { referencePaletteSource, parseLineRefs, buildLineWithRefs } from '@/app/editor/noteEditorServices';
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
  // No palette token exists for equipment yet — neutral styling keeps it
  // distinguishable via the icon/label without redesigning the palette.
  [MetricType.Equipment]: {
    label: "Equipment", icon: "🧰",
    textClass: "text-foreground",
    bgClass:   "bg-muted/40",
    borderClass: "border-border/50",
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
    metric.image ?? (metric.value !== undefined ? String(metric.value) : "");
  const label = style?.label ?? String(metric.type);

  return (
    <span
      title={tooltip}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium",
        "pointer-events-auto transition-opacity hover:opacity-80",
        style?.bgClass ?? "bg-muted/30",
        style?.textClass ?? "text-muted-foreground",
        style?.borderClass ?? "border-border/40",
        onClick && "cursor-pointer",
        isFocused && "font-bold shadow-sm",
      )}
    >
      <span>{isHint ? metric.icon : (style?.icon ?? "•")}</span>
      {!isHint && <span>{label}</span>}
      {!isHint && displayVal && (
        <span className="font-semibold">{displayVal}</span>
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
  width: number;
}

function computePosition(
  view: EditorView,
  lineFrom: number
): PanelPosition | null {
  try {
    const coords = view.coordsAtPos(lineFrom);
    if (!coords) return null;
    const editorRect = view.dom?.getBoundingClientRect?.() ?? { top: 0, left: 0 };
    const contentRect = view.contentDOM?.getBoundingClientRect?.() ?? { left: 0, width: 0 };
    return {
      top: coords.bottom - editorRect.top,   // flush below text in the active line's padding space
      left: contentRect.left - editorRect.left,  // relative to editor left (accounting for gutter)
      width: contentRect.width,
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
    setPos(nextFocus ? computePosition(view, nextFocus.lineFrom) : null);
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

  // Don't render if cursor is outside a WOD section
  if (!pos || !focus?.section) return null;

  const lineStatements = focus.allStatements?.filter(s => s.meta?.line === focus.cursorLine - focus.section.startLine)
    ?? (focus.statement ? [focus.statement] : []);
  const visibleMetrics = lineStatements.flatMap(s => s.metrics.toArray()).filter(
    (m) => m.type !== MetricType.Sound && m.type !== MetricType.System
      // Hints are data-only unless authored with an icon; iconed hints render as icon + hover text.
      && !(m.type === MetricType.Hint && !m.icon)
  );
  // Same presentation tokens the effort widget's badges use (tooltip content).
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
  const referenceProvider = view ? (view.state.facet(frontmatterReferenceIndex)?.() ?? null) : null;
  const lineRefs = view ? parseLineRefs(view.state.doc.sliceString(focus.lineFrom, focus.lineTo)) : null;

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

  const repairDiagnostic = async (diag: DiagnosticShape) => {
    if (!view || !diag.token) return;
    const kind = diagnosticKind(diag);
    const palette = usePaletteStore.getState();
    const result = await palette.open({
      placeholder: `Replace “${diag.token}”…`,
      sources: [referencePaletteSource(kind, diag.candidates)],
    });
    if (result.dismissed) return;
    const slug = payloadSlug(result.item.payload);
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
        "absolute z-50 pointer-events-none",
        "flex items-center gap-2 px-3 h-[28px]",
        "bg-background/90 backdrop-blur-sm",
        "border-l border-r border-border/50",
        "transition-opacity duration-100",
      )}
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxWidth: pos.width,
      }}
      aria-live="polite"
      aria-label="Metric inline panel"
    >
      {visibleMetrics.length > 0 ? (
        <>
          <span className="text-[10px] text-muted-foreground font-medium shrink-0 select-none">
            Metrics:
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
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
            {refs.map((ref) => (
              <span
                key={`${ref.kind}:${ref.slug}`}
                title={`${ref.kind === 'effort' ? 'Effort' : 'Equipment'} · click to change source`}
                onClick={() => void changeRefSource(ref.kind)}
                className="pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer hover:opacity-80 bg-muted/40 text-foreground border-border/50"
              >
                <span>{ref.kind === 'effort' ? '🏋' : '🧰'}</span>
                <span className="font-semibold">{ref.label}</span>
                {referenceProvider && (
                  <a
                    href={referenceProvider.openHref(ref.kind, ref.slug)}
                    title={`Open ${ref.label} page`}
                    aria-label={`Open ${ref.label} page`}
                    className="text-muted-foreground/70 hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                )}
              </span>
            ))}

            {/* Malformed reference JSON refuses structured rewrites; the
                authored text stays and the user fixes it in place. */}
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

            {/* Unknown/ambiguous/conflicting references stay visible with
                select-existing and create-page actions — never silent. */}
            {diagnostics.map((diag, i) => {
              const diagKind = diagnosticKind(diag);
              return (
                <span
                  key={`${diag.reason}-${i}`}
                  data-testid="editor-ref-unknown"
                  title={diag.message}
                  className="pointer-events-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium bg-destructive/10 text-destructive border-destructive/30"
                >
                  <span>⚠</span>
                  <span>{diag.token ?? diag.reason}</span>
                  <button
                    type="button"
                    className="underline cursor-pointer"
                    onClick={() => void repairDiagnostic(diag)}
                  >
                    Select existing
                  </button>
                  {referenceProvider && (
                    <a href={referenceProvider.createHref(diagKind)} className="underline hover:text-foreground">
                      Create page
                    </a>
                  )}
                </span>
              );
            })}

            <button
              type="button"
              data-testid="editor-add-metric-line"
              title="Add effort/equipment reference to this line"
              onClick={() => void addLineMetric()}
              className="pointer-events-auto inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-border/60 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 cursor-pointer"
            >
              + Metric
            </button>
          </div>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground/50 italic select-none">
          No metrics on this line
        </span>
      )}

      {/* Keyboard hint */}
      <span className="ml-auto text-[9px] text-muted-foreground/40 shrink-0 select-none">
        Ctrl+↑↓ · adjust value
      </span>
    </div>
  );
};
