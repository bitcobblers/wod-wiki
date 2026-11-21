/**
 * MetricInlinePanel
 *
 * Utilitarian Minimalism inline token strip rendered adjacent to or directly
 * below the active cursor line inside Whiteboard Script blocks. Exposes
 * clickable token chips that open the unified Syntax Token Inspector popover
 * (or Option B drawer), one-click line lint fixes, inline catalog creation,
 * and Block / Drawer controls.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import {
  ArrowsClockwiseIcon,
  ArrowUpRightIcon,
  BarbellIcon,
  HashIcon,
  LightningIcon,
  RulerIcon,
  ScalesIcon,
  SlidersHorizontalIcon,
  SidebarSimpleIcon,
  TagIcon,
  TimerIcon,
  ToolboxIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { MetricType } from "@bitcobblers/wod-wiki-engine";
import type { IMetric } from "@bitcobblers/wod-wiki-engine";
import {
  getReferenceMetadata,
  getTagReference,
  type TagReferenceMetadata,
} from "@bitcobblers/wod-wiki-core";
import {
  frontmatterReferenceIndex,
} from "@bitcobblers/wod-wiki-ui/extensions";
import { getCursorFocusState, type CursorFocusState } from "@/app/editor/cursorFocusExtension";
import { presentThemedGroup } from "@/components/metrics/presentation";
import { usePaletteStore } from "@/components/organisms/command-palette/palette-store";
import {
  addInlineEffortAlias,
  buildLineWithRefs,
  createInlineEffortFromToken,
  createInlineEquipmentFromToken,
  createInlineTagFromSlug,
  parseLineRefs,
  referencePaletteSource,
} from "@/app/editor/noteEditorServices";
import { catalogueReload } from "@/app/editor/catalogueReload";
import type { ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import {
  loadNotebookScopeSnapshot,
  type NotebookScopeSnapshot,
} from "@/components/organisms/editor/wheelSources";
import {
  applyQuickFixInView,
  extractLineTokens,
  parseDistanceToken,
  parseDurationToken,
  parseResistanceToken,
  type EditDiffSummary,
  type InspectorMode,
  type InspectorToken,
  type InspectorTokenKind,
  type LineInspection,
} from "@/components/organisms/editor/whiteboard-inspector/tokenModel";
import { WhiteboardInspectorPopover } from "@/components/organisms/editor/whiteboard-inspector/WhiteboardInspectorPopover";
import { TEST_IDS } from "@/lib/testIds";
import { cn } from "@/lib/utils";

interface MetricStyle {
  label: string;
  Icon: React.ComponentType<{ className?: string; weight?: "bold" | "regular" | "fill" }>;
  textClass: string;
  bgClass: string;
  borderClass: string;
}

const METRIC_STYLES: Partial<Record<string, MetricStyle>> = {
  [MetricType.Duration]: {
    label: "Timer",
    Icon: TimerIcon,
    textClass: "text-metric-time",
    bgClass: "bg-metric-time/10",
    borderClass: "border-metric-time/30",
  },
  [MetricType.Rep]: {
    label: "Reps",
    Icon: HashIcon,
    textClass: "text-metric-rep",
    bgClass: "bg-metric-rep/10",
    borderClass: "border-metric-rep/30",
  },
  [MetricType.Effort]: {
    label: "Exercise",
    Icon: BarbellIcon,
    textClass: "text-metric-effort",
    bgClass: "bg-metric-effort/10",
    borderClass: "border-metric-effort/30",
  },
  [MetricType.Rounds]: {
    label: "Rounds",
    Icon: ArrowsClockwiseIcon,
    textClass: "text-metric-rounds",
    bgClass: "bg-metric-rounds/10",
    borderClass: "border-metric-rounds/30",
  },
  [MetricType.Distance]: {
    label: "Distance",
    Icon: RulerIcon,
    textClass: "text-metric-distance",
    bgClass: "bg-metric-distance/10",
    borderClass: "border-metric-distance/30",
  },
  [MetricType.Resistance]: {
    label: "Weight",
    Icon: ScalesIcon,
    textClass: "text-metric-resistance",
    bgClass: "bg-metric-resistance/10",
    borderClass: "border-metric-resistance/30",
  },
  [MetricType.Equipment]: {
    label: "Equipment",
    Icon: ToolboxIcon,
    textClass: "text-metric-equipment",
    bgClass: "bg-metric-equipment/10",
    borderClass: "border-metric-equipment/30",
  },
  [MetricType.Action]: {
    label: "Action",
    Icon: LightningIcon,
    textClass: "text-metric-action",
    bgClass: "bg-metric-action/10",
    borderClass: "border-metric-action/30",
  },
  [MetricType.Label]: {
    label: "Label",
    Icon: TagIcon,
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/40",
    borderClass: "border-border",
  },
};

const EMPTY_SCOPE: NotebookScopeSnapshot = {
  tags: [],
  defaultEquipment: [],
  customMetricTypes: [],
};

function mapMetricTypeToTokenKind(type: string): InspectorTokenKind {
  switch (type) {
    case MetricType.Duration:
      return "duration";
    case MetricType.Rep:
      return "rep";
    case MetricType.Rounds:
      return "rounds";
    case MetricType.Effort:
      return "effort";
    case MetricType.Equipment:
      return "equipment";
    case MetricType.Resistance:
      return "resistance";
    case MetricType.Distance:
      return "distance";
    case MetricType.Action:
      return "action";
    default:
      return "custom";
  }
}

function resolveTokenForMetric(
  metric: IMetric,
  inspection: LineInspection,
  index: number,
  focus: CursorFocusState,
): InspectorToken {
  const fromExact = inspection.tokens.find((t) => t.metric === metric);
  if (fromExact) return fromExact;

  const targetKind = mapMetricTypeToTokenKind(metric.type as string);
  const rawCandidate = String(metric.image ?? metric.value ?? "").trim();
  const matched = inspection.tokens.find(
    (t) =>
      t.kind === targetKind &&
      (rawCandidate === "" ||
        t.raw.trim().toLowerCase() === rawCandidate.toLowerCase() ||
        t.raw.toLowerCase().includes(rawCandidate.toLowerCase())),
  );
  if (matched) return matched;

  const kind = mapMetricTypeToTokenKind(metric.type as string);
  const fallbackRaw = rawCandidate || String(metric.type);
  const tok: InspectorToken = {
    id: `fallback-${kind}-${index}`,
    kind,
    raw: fallbackRaw,
    displayLabel: kind === "rep" ? `${fallbackRaw} reps` : fallbackRaw,
    from: focus.lineFrom,
    to: focus.lineTo,
    lineNum: focus.cursorLine,
    metric,
  };
  if (kind === "duration") tok.durationMeta = parseDurationToken(fallbackRaw);
  if (kind === "resistance") tok.resistanceMeta = parseResistanceToken(fallbackRaw);
  if (kind === "distance") tok.distanceMeta = parseDistanceToken(fallbackRaw);
  return tok;
}

const MetricChip: React.FC<{
  metric: IMetric;
  tooltip?: string;
  isFocused: boolean;
  isSelected?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ metric, tooltip, isFocused, isSelected, onClick }) => {
  const style = METRIC_STYLES[metric.type as string];
  const isHint = metric.type === MetricType.Hint;
  const displayVal =
    metric.name ?? metric.image ?? (metric.value !== undefined ? String(metric.value) : "");
  const label = style?.label ?? String(metric.type);
  const IconComp = style?.Icon;

  const sharedClass = cn(
    "inline-flex items-center gap-1 px-2 py-0.5 min-h-[24px] rounded-full border text-[11px] leading-tight font-medium whitespace-nowrap tabular-nums",
    "pointer-events-auto transition-all",
    style?.bgClass ?? "bg-muted/40",
    style?.textClass ?? "text-muted-foreground",
    style?.borderClass ?? "border-border",
    isFocused && "font-bold ring-1 ring-foreground/20",
    isSelected && "ring-2 ring-primary/50 border-primary",
  );

  if (isHint) {
    return (
      <span title={tooltip} className={sharedClass}>
        <span>{metric.icon}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      data-inspector-trigger="true"
      title={tooltip}
      onClick={onClick}
      className={cn(
        sharedClass,
        "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring cursor-pointer",
      )}
    >
      {IconComp ? <IconComp weight="bold" className="h-3 w-3 shrink-0" /> : null}
      <span className="sr-only">{label}</span>
      <span className="font-semibold">{displayVal || label}</span>
    </button>
  );
};

interface ReferenceRefShape {
  kind: "effort" | "equipment";
  slug: string;
  label: string;
  matchedAlias?: string;
}

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
    const endCoords =
      typeof focus.lineTo === "number"
        ? (view.coordsAtPos(focus.lineTo) ?? lineCoords)
        : lineCoords;
    const editorRect = view.dom?.getBoundingClientRect?.() ?? { top: 0, left: 0, width: 600 };
    const contentRect = view.contentDOM?.getBoundingClientRect?.() ?? { left: 0, width: 600 };

    const contentLeft = Math.max(0, contentRect.left - editorRect.left);
    const contentRight = contentLeft + Math.max(240, contentRect.width);
    const endLeft = endCoords.left - editorRect.left + 12;
    const roomAtEnd = contentRight - endLeft;

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

export interface OpenInspectorRequest {
  mode: InspectorMode;
  token: InspectorToken | null;
  anchorRect: DOMRect | null;
}

export interface MetricInlinePanelProps {
  view: EditorView | null;
  cursorVersion: number;
  getCursorFocusState?: typeof getCursorFocusState;
  commands?: ScriptCommand[];
  noteId?: string;
  hidden?: boolean;
  activeTokenId?: string | null;
  drawerOpen?: boolean;
  onOpenInspector?: (request: OpenInspectorRequest) => void;
  onToggleDrawer?: () => void;
}

export const MetricInlinePanel: React.FC<MetricInlinePanelProps> = ({
  view,
  cursorVersion,
  getCursorFocusState: getCursorFocusStateProp,
  noteId,
  hidden = false,
  activeTokenId = null,
  drawerOpen = false,
  onOpenInspector,
  onToggleDrawer,
}) => {
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const [focus, setFocus] = useState<CursorFocusState | null>(null);
  const [openDiagKey, setOpenDiagKey] = useState<string | null>(null);
  const [scope, setScope] = useState<NotebookScopeSnapshot>(EMPTY_SCOPE);
  const [localInspector, setLocalInspector] = useState<{
    mode: InspectorMode;
    token: InspectorToken | null;
    anchorRect: DOMRect | null;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    if (!view || hidden) {
      setFocus(null);
      setPos(null);
      return;
    }

    const nextFocus = (getCursorFocusStateProp ?? getCursorFocusState)(view.state);
    setFocus(nextFocus);
    setPos(nextFocus ? computePosition(view, nextFocus) : null);
  }, [view, getCursorFocusStateProp, hidden]);

  useEffect(() => {
    update();
  }, [update, cursorVersion]);

  useEffect(() => {
    if (!view || hidden) return;
    const handler = () => update();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler, true);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler, true);
    };
  }, [view, update, hidden]);

  // Load notebook scope only when the standalone popover fallback is active
  const docText =
    view?.state?.doc && typeof view.state.doc.toString === "function"
      ? view.state.doc.toString()
      : "";

  useEffect(() => {
    if (onOpenInspector || !localInspector || !docText) return;
    let cancelled = false;
    void loadNotebookScopeSnapshot(noteId, docText).then((snap) => {
      if (!cancelled) setScope(snap);
    });
    return () => {
      cancelled = true;
    };
  }, [onOpenInspector, localInspector, noteId, docText]);

  const inspection: LineInspection = useMemo(() => {
    if (!view?.state || !focus) {
      return {
        contextKind: "markdown",
        section: null,
        focus: null,
        lineNum: 1,
        lineFrom: 0,
        lineTo: 0,
        lineText: "",
        tokens: [],
        lintFixes: [],
      };
    }
    try {
      return extractLineTokens(view.state, focus);
    } catch {
      return {
        contextKind: "markdown",
        section: focus.section,
        focus,
        lineNum: focus.cursorLine,
        lineFrom: focus.lineFrom,
        lineTo: focus.lineTo,
        lineText:
          typeof view.state.doc?.sliceString === "function"
            ? view.state.doc.sliceString(focus.lineFrom, focus.lineTo)
            : "",
        tokens: [],
        lintFixes: [],
      };
    }
  }, [view, focus]);

  const compStatus =
    view?.state && typeof view.state.field === "function"
      ? completionStatus(view.state)
      : null;
  const isAutocompleteOpen = compStatus === "active";
  const isCompletionBusy = compStatus !== null;
  if (hidden || !pos || !focus?.section || isAutocompleteOpen) return null;

  const lineStatements =
    focus.allStatements?.filter(
      (s) => s.meta?.line === focus.cursorLine - focus.section.startLine,
    ) ?? (focus.statement ? [focus.statement] : []);

  const visibleMetrics = lineStatements
    .flatMap((s) => s.metrics.toArray())
    .filter((m) => {
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
  const tokens = presentThemedGroup(visibleMetrics, "runtime-badge");

  const lineMetrics = lineStatements.flatMap((s) => s.metrics.toArray());
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

  const tagRefs: TagReferenceMetadata[] = [];
  const unresolvedTagSlugs: string[] = [];
  for (const metric of lineMetrics) {
    const reference = getTagReference(metric.metadata);
    if (reference) {
      if (!tagRefs.some((existing) => existing.slug === reference.slug)) {
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

  const referenceProvider =
    typeof view?.state?.facet === "function"
      ? (view.state.facet(frontmatterReferenceIndex)?.() ?? null)
      : null;
  const lineRefs =
    typeof view?.state?.doc?.sliceString === "function"
      ? parseLineRefs(view.state.doc.sliceString(focus.lineFrom, focus.lineTo))
      : null;

  const diagnosticKind = (diag: DiagnosticShape): "effort" | "equipment" => {
    if (diag.reason === "conflict" || diag.reason.endsWith("equipment")) return "equipment";
    if (diag.reason === "invalid-explicit") {
      if (diag.token && lineRefs?.equipment.includes(diag.token)) return "equipment";
    }
    return "effort";
  };

  const payloadSlug = (payload: unknown): string | null =>
    typeof payload === "string" && payload.trim() ? payload : null;

  const openUnifiedInspector = (
    mode: InspectorMode,
    tok: InspectorToken | null,
    targetEl?: HTMLElement | null,
  ) => {
    const anchorRect = targetEl?.getBoundingClientRect?.() ?? null;
    if (onOpenInspector) {
      onOpenInspector({ mode, token: tok, anchorRect });
      return;
    }
    setLocalInspector((prev) =>
      prev && prev.mode === mode && prev.token?.id === tok?.id
        ? null
        : { mode, token: tok, anchorRect },
    );
  };

  const changeRefSource = async (kind: "effort" | "equipment") => {
    if (!view) return;
    const lineText = view.state.doc.sliceString(focus.lineFrom, focus.lineTo);
    const palette = usePaletteStore.getState();
    if (kind === "effort") {
      const result = await palette.open({
        placeholder: "Change effort...",
        sources: [referencePaletteSource("effort")],
      });
      if (result.dismissed) return;
      const slug = payloadSlug(result.item.payload);
      if (!slug) return;
      view.dispatch({
        changes: {
          from: focus.lineFrom,
          to: focus.lineTo,
          insert: buildLineWithRefs(lineText, { effort: slug }),
        },
      });
      return;
    }
    const equipment = [...(lineRefs?.equipment ?? [])];
    for (;;) {
      const result = await palette.open({
        placeholder:
          equipment.length > 0 ? "Add equipment (Esc to finish)..." : "Set equipment...",
        sources: [referencePaletteSource("equipment")],
      });
      if (result.dismissed) break;
      const slug = payloadSlug(result.item.payload);
      if (slug && !equipment.includes(slug)) equipment.push(slug);
    }
    if ((lineRefs?.jsonFrom ?? -1) >= 0 || equipment.length > 0) {
      view.dispatch({
        changes: {
          from: focus.lineFrom,
          to: focus.lineTo,
          insert: buildLineWithRefs(lineText, { equipment }),
        },
      });
    }
  };

  const addLineMetric = async () => {
    if (!view) return;
    const lineText = view.state.doc.sliceString(focus.lineFrom, focus.lineTo);
    const palette = usePaletteStore.getState();
    let effort: string | undefined;
    const effortResult = await palette.open({
      placeholder: "Add effort (Esc to skip)...",
      sources: [referencePaletteSource("effort")],
    });
    if (!effortResult.dismissed) effort = payloadSlug(effortResult.item.payload) ?? undefined;
    const equipment: string[] = [];
    for (;;) {
      const result = await palette.open({
        placeholder: "Add equipment (Esc to finish)...",
        sources: [referencePaletteSource("equipment")],
      });
      if (result.dismissed) break;
      const slug = payloadSlug(result.item.payload);
      if (slug && !equipment.includes(slug)) equipment.push(slug);
    }
    if (!effort && equipment.length === 0) return;
    view.dispatch({
      changes: {
        from: focus.lineFrom,
        to: focus.lineTo,
        insert: buildLineWithRefs(lineText, { effort, equipment }),
      },
    });
  };

  const dispatchReload = () => {
    if (view && typeof view.dispatch === "function") {
      view.dispatch({ effects: [catalogueReload.of(null)] });
    }
    update();
  };

  const repairDiagnostic = async (diag: DiagnosticShape) => {
    if (!view || !diag.token) return;
    const kind = diagnosticKind(diag);
    const palette = usePaletteStore.getState();
    const result = await palette.open({
      placeholder: `Replace "${diag.token}"...`,
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

  const handleCreateFromToken = async (kind: "effort" | "equipment", tokenText: string) => {
    if (!tokenText.trim()) return;
    if (kind === "effort") {
      await createInlineEffortFromToken(tokenText);
    } else {
      await createInlineEquipmentFromToken(tokenText);
    }
    dispatchReload();
  };

  const handleAddAliasFromToken = async (tokenText: string) => {
    if (!tokenText.trim()) return;
    const palette = usePaletteStore.getState();
    const result = await palette.open({
      placeholder: `Link "${tokenText}" as alias to effort...`,
      sources: [referencePaletteSource("effort")],
    });
    if (result.dismissed) return;
    const targetSlug = payloadSlug((result as { item: { payload?: unknown } }).item.payload);
    if (!targetSlug) return;
    await addInlineEffortAlias(targetSlug, tokenText);
    dispatchReload();
  };

  const handleCreateTag = async (slug: string) => {
    if (!slug.trim()) return;
    await createInlineTagFromSlug(slug);
    dispatchReload();
  };

  const handleChipClick = (
    metric: IMetric,
    index: number,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!view) return;
    const kind: "effort" | "equipment" | null =
      metric.type === MetricType.Effort
        ? "effort"
        : metric.type === MetricType.Equipment
          ? "equipment"
          : null;
    if (kind && lineRefs?.jsonFrom !== undefined && lineRefs.jsonFrom >= 0) {
      void changeRefSource(kind);
      return;
    }

    const tok = resolveTokenForMetric(metric, inspection, index, focus);
    openUnifiedInspector("token", tok, event.currentTarget);
  };

  const handleRefClick = (
    ref: ReferenceRefShape,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (lineRefs?.jsonFrom !== undefined && lineRefs.jsonFrom >= 0) {
      void changeRefSource(ref.kind);
      return;
    }
    const matched = inspection.tokens.find(
      (t) =>
        t.refSlug === ref.slug ||
        (t.kind === ref.kind && t.raw.toLowerCase().includes(ref.label.toLowerCase())),
    );
    const tok: InspectorToken = matched ?? {
      id: `ref-${ref.kind}-${ref.slug}`,
      kind: ref.kind,
      raw: ref.label,
      displayLabel: ref.label,
      from: focus.lineFrom,
      to: focus.lineTo,
      lineNum: focus.cursorLine,
      refKind: ref.kind,
      refSlug: ref.slug,
    };
    openUnifiedInspector("token", tok, event.currentTarget);
  };

  const hasWorkoutContent =
    visibleMetrics.length > 0 ||
    refs.length > 0 ||
    tagRefs.length > 0 ||
    diagnostics.length > 0 ||
    unresolvedTagSlugs.length > 0 ||
    inspection.lintFixes.length > 0;

  const isRealDoc = Boolean(view?.state?.doc && typeof view.state.doc.lineAt === "function");
  const isWorkoutSection =
    focus.section.type === "time" || focus.section.type === "log";
  const blockDialect = focus.section.type === "log" ? "log" : "time";

  const activeLocalToken =
    localInspector?.token &&
    inspection.tokens.find(
      (t) =>
        t.id === localInspector.token?.id ||
        (t.from === localInspector.token?.from && t.kind === localInspector.token?.kind),
    );

  const handleLocalStep = (delta: -1 | 1) => {
    if (!localInspector || inspection.tokens.length === 0) return;
    const currentIdx = inspection.tokens.findIndex(
      (t) => t.id === (activeLocalToken?.id ?? localInspector.token?.id),
    );
    const baseIdx = currentIdx >= 0 ? currentIdx : 0;
    const nextIdx = (baseIdx + delta + inspection.tokens.length) % inspection.tokens.length;
    setLocalInspector((prev) =>
      prev ? { ...prev, token: inspection.tokens[nextIdx] } : prev,
    );
  };

  const handleLocalMutate = (_diff: EditDiffSummary | null, _toast: string) => {
    update();
  };

  return (
    <>
      <div
        ref={panelRef}
        className={cn(
          "cm-metric-inline-panel",
          "absolute z-[15]",
          "inline-flex items-center gap-1 px-1.5 py-0.5 min-h-[24px]",
          pos.belowLine
            ? "pointer-events-auto bg-card/95 border border-border rounded-md shadow-xs"
            : "pointer-events-none bg-transparent",
          "transition-opacity duration-100 max-w-full",
        )}
        style={{
          top: pos.top,
          left: pos.left,
          maxWidth: pos.maxWidth,
        }}
        role="region"
        aria-live={isCompletionBusy ? "off" : "polite"}
        aria-label="Metric inline panel"
      >
        {hasWorkoutContent ? (
          <div
            data-testid={TEST_IDS.EDITOR_TOKEN_STRIP}
            className={cn(
              "flex items-center gap-1",
              pos.belowLine
                ? "flex-wrap"
                : "flex-nowrap overflow-x-auto max-w-full scrollbar-none",
            )}
          >
            {visibleMetrics.map((metric, i) => {
              const matchedTok = inspection.tokens.find((t) => t.metric === metric);
              const isSelected = Boolean(activeTokenId && matchedTok?.id === activeTokenId);
              return (
                <MetricChip
                  key={`${metric.type}-${i}`}
                  metric={metric}
                  tooltip={
                    metric.type === MetricType.Hint
                      ? String(metric.value ?? "")
                      : tokens[i]?.tooltip
                  }
                  isFocused={focus.focusedMetric === metric}
                  isSelected={isSelected}
                  onClick={(e) => handleChipClick(metric, i, e)}
                />
              );
            })}

            {refs.map((ref) => {
              const isFocusedRef =
                (ref.kind === "effort" && focus.focusedMetric?.type === MetricType.Effort) ||
                (ref.kind === "equipment" && focus.focusedMetric?.type === MetricType.Equipment);
              const RefIcon = ref.kind === "effort" ? BarbellIcon : ToolboxIcon;
              return (
                <div
                  key={`${ref.kind}:${ref.slug}`}
                  className={cn(
                    "pointer-events-auto inline-flex items-center gap-0.5 px-2 py-0.5 min-h-[22px] rounded-full border text-[11px] leading-tight font-medium whitespace-nowrap",
                    ref.kind === "effort"
                      ? "bg-metric-effort/10 text-metric-effort border-metric-effort/30"
                      : "bg-metric-equipment/10 text-metric-equipment border-metric-equipment/30",
                    isFocusedRef && "font-bold ring-1 ring-foreground/20",
                  )}
                >
                  <button
                    type="button"
                    data-inspector-trigger="true"
                    title={`${ref.kind === "effort" ? "Effort" : "Equipment"}: ${ref.label} (${ref.slug})${ref.matchedAlias ? ` · matched alias "${ref.matchedAlias}"` : ""} · click to edit or change`}
                    onClick={(e) => handleRefClick(ref, e)}
                    className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
                  >
                    <RefIcon weight="bold" className="h-3 w-3 shrink-0" />
                    <span className="sr-only">{ref.kind === "effort" ? "Exercise" : "Equipment"}</span>
                    <span className="font-semibold">{ref.label}</span>
                  </button>
                  {referenceProvider && (
                    <a
                      href={referenceProvider.openHref(ref.kind, ref.slug)}
                      title={`Open ${ref.label} page`}
                      aria-label={`Open ${ref.label} page`}
                      className="opacity-70 hover:opacity-100 ml-0.5 inline-flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ArrowUpRightIcon weight="bold" className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              );
            })}

            {tagRefs.map((ref) => (
              <div
                key={`tag:${ref.slug}`}
                className="pointer-events-auto inline-flex items-center gap-0.5 px-2 py-0.5 min-h-[22px] rounded-full border text-[11px] leading-tight font-medium bg-primary/10 text-primary border-primary/30 whitespace-nowrap"
              >
                <button
                  type="button"
                  data-inspector-trigger="true"
                  title={
                    ref.soundProfileId
                      ? `Tag ${ref.label} · names the ${ref.soundProfileId} sound profile`
                      : `Tag ${ref.label}`
                  }
                  onClick={(e) =>
                    openUnifiedInspector(
                      "token",
                      inspection.tokens.find((t) => t.isTag && t.raw.includes(ref.slug)) ?? {
                        id: `tag-${ref.slug}`,
                        kind: "tag",
                        raw: `#${ref.slug}`,
                        displayLabel: `#${ref.slug}`,
                        from: focus.lineFrom,
                        to: focus.lineTo,
                        lineNum: focus.cursorLine,
                        tagRef: ref,
                        isTag: true,
                      },
                      e.currentTarget,
                    )
                  }
                  className="inline-flex items-center gap-0.5 cursor-pointer hover:opacity-80"
                >
                  <span>#</span>
                  <span className="font-semibold font-mono">{ref.label}</span>
                </button>
                {referenceProvider && (
                  <a
                    href={referenceProvider.openHref("tag", ref.slug)}
                    title={`Open the ${ref.label} tag`}
                    aria-label={`Open the ${ref.label} tag`}
                    className="opacity-70 hover:opacity-100 ml-0.5 inline-flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ArrowUpRightIcon weight="bold" className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            ))}

            {inspection.lintFixes.map((fix) => (
              <span
                key={fix.id}
                className="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 min-h-[22px] rounded-full border border-dashed text-[11px] leading-tight font-medium bg-destructive/10 text-destructive border-destructive/30 whitespace-nowrap"
                title={fix.message}
              >
                <WarningCircleIcon weight="bold" className="h-3 w-3 shrink-0" />
                <span className="font-mono">{fix.raw}</span>
                {fix.fixes.slice(0, 2).map((rep) => (
                  <button
                    key={rep}
                    type="button"
                    data-testid={TEST_IDS.EDITOR_LINT_QUICK_FIX}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (view) applyQuickFixInView(view, fix, rep);
                    }}
                    className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground hover:bg-primary hover:text-primary-foreground cursor-pointer transition-colors"
                  >
                    Fix: {rep}
                  </button>
                ))}
              </span>
            ))}

            {lineRefs?.malformed && (
              <span
                data-testid="editor-ref-unknown"
                title="Reference JSON on this line does not parse — fix it in the raw text."
                className="pointer-events-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border text-[11px] font-medium bg-destructive/10 text-destructive border-destructive/30"
              >
                <WarningCircleIcon weight="bold" className="h-3 w-3 shrink-0" />
                <span>Malformed reference JSON</span>
              </span>
            )}

            {unresolvedTagSlugs.map((slug) => (
              <span
                key={`unresolved-tag:${slug}`}
                data-testid="editor-tag-unknown"
                title={`Unknown tag #${slug} — click to create`}
                className="pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-full border border-dashed text-[11px] leading-tight font-medium bg-warning/10 text-warning border-warning/40 whitespace-nowrap"
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
              const tokenText = diag.token?.trim() ?? "";
              const isUnknownEffort = diag.reason === "unknown-effort";
              const diagKey = `${diag.reason}-${tokenText || i}`;
              const isExpanded = openDiagKey === diagKey || openDiagKey === "all";
              return (
                <span
                  key={diagKey}
                  data-testid="editor-ref-unknown"
                  title={diag.message}
                  onClick={() => {
                    if (!isExpanded) setOpenDiagKey(diagKey);
                  }}
                  className={cn(
                    "pointer-events-auto inline-flex flex-wrap items-center gap-1.5 px-2 py-0.5 min-h-[22px] rounded-[6px] border border-dashed text-[11px] leading-tight font-medium bg-warning/10 text-warning border-warning/40 max-w-full",
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
                      Define
                    </button>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1.5 pl-1 border-l border-warning/30">
                      {tokenText && (
                        <button
                          type="button"
                          data-testid={`editor-create-${diagKind}-inline`}
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCreateFromToken(diagKind, tokenText);
                          }}
                        >
                          + {diagKind === "effort" ? "Effort" : "Equipment"}
                        </button>
                      )}
                      {tokenText && isUnknownEffort && (
                        <button
                          type="button"
                          data-testid="editor-link-alias-inline"
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAddAliasFromToken(tokenText);
                          }}
                        >
                          + Alias
                        </button>
                      )}
                      {tokenText && isUnknownEffort && (
                        <button
                          type="button"
                          data-testid="editor-create-equipment-from-token"
                          className="underline cursor-pointer hover:text-foreground font-semibold"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCreateFromToken("equipment", tokenText);
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
              className="pointer-events-auto inline-flex items-center px-2 py-0.5 min-h-[22px] rounded-full border border-dashed border-border text-[11px] leading-tight text-muted-foreground hover:text-foreground hover:border-foreground cursor-pointer whitespace-nowrap"
            >
              + Metric
            </button>

            {isRealDoc && isWorkoutSection && (
              <button
                type="button"
                data-inspector-trigger="true"
                data-testid={TEST_IDS.EDITOR_BLOCK_SETTINGS_BTN}
                title={`Configure ${blockDialect.toUpperCase()} block header or templates`}
                onClick={(e) =>
                  openUnifiedInspector("block", inspection.tokens[0] ?? null, e.currentTarget)
                }
                className="pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-full border border-border bg-muted/40 text-[11px] leading-tight font-medium text-muted-foreground hover:text-foreground cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontalIcon weight="bold" className="h-3 w-3 shrink-0" />
                <span>{blockDialect === "log" ? "LOG" : "TIMER"}</span>
              </button>
            )}

            {onToggleDrawer && (
              <button
                type="button"
                data-inspector-trigger="true"
                data-testid={TEST_IDS.EDITOR_INSPECTOR_DRAWER_TOGGLE}
                aria-pressed={drawerOpen}
                title="Toggle Right Inspector Drawer (Ctrl+Alt+I / Cmd+Alt+I)"
                onClick={onToggleDrawer}
                className={cn(
                  "pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-full border text-[11px] leading-tight font-medium cursor-pointer whitespace-nowrap transition-colors",
                  drawerOpen
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <SidebarSimpleIcon weight="bold" className="h-3 w-3 shrink-0" />
                <span>Drawer</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground/70 italic select-none">
              No metrics on this line
            </span>
            {isRealDoc && isWorkoutSection && (
              <button
                type="button"
                data-inspector-trigger="true"
                data-testid={TEST_IDS.EDITOR_BLOCK_SETTINGS_BTN}
                onClick={(e) => openUnifiedInspector("add", null, e.currentTarget)}
                className="pointer-events-auto inline-flex items-center gap-1 px-2 py-0.5 min-h-[22px] rounded-full border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                + Token
              </button>
            )}
          </div>
        )}
      </div>

      {!onOpenInspector && localInspector && (
        <WhiteboardInspectorPopover
          open
          anchorRect={localInspector.anchorRect}
          editorDom={view?.dom ?? null}
          view={view}
          mode={localInspector.mode}
          inspection={inspection}
          token={activeLocalToken ?? localInspector.token}
          scope={scope}
          docText={docText}
          onClose={() => setLocalInspector(null)}
          onMutate={handleLocalMutate}
          onModeChange={(nextMode) =>
            setLocalInspector((prev) => (prev ? { ...prev, mode: nextMode } : prev))
          }
          onStepToken={handleLocalStep}
        />
      )}
    </>
  );
};
