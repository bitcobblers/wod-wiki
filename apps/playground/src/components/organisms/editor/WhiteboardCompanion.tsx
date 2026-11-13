/**
 * WhiteboardCompanion
 *
 * Overlay companion for time / log fenced code blocks.
 *
 * Layout modes:
 *   INACTIVE (15% strip) — cursor is outside the block.
 *     Shows action buttons (Run, Plan, …) as a compact vertical column.
 *     Shows a minimized latest result line if results exist.
 *
 *   ACTIVE (35% panel) — cursor is inside the block.
 *     Top: Latest result line (if any)
 *     Middle: Metric chips for the statement under the cursor.
 *     Bottom: History of previous results and action buttons.
 */

import React, { useMemo, useState, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import type { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { MdTimerRuntime } from "@/hooks/useRuntimeParser";
import { sectionField, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/dateFormat";
import type { ScriptBlock, FenceDialect } from '@/components/Editor/types';
import type { ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import { useScriptBlockResults } from '@/components/Editor/hooks/useScriptBlockResults';
import { useScriptLineResults } from '@/components/Editor/hooks/useScriptLineResults';
import type { LineExecutionSummary } from '@/components/Editor/hooks/useScriptLineResults';
import { History, Activity } from "lucide-react";
import { Button } from "@/components/atoms/primitives/button";
import { ButtonGroup } from "@/components/molecules/ButtonGroup";
import type { INavActivation } from "@/nav/navTypes";
import { TEST_IDS } from "@/lib/testIds";

// ── Singleton parser (created once per module) ───────────────────────
const parser = new MdTimerRuntime();

// ── Helpers ──────────────────────────────────────────────────────────

/** Get the EditorSection for this sectionId. */
function getSection(view: EditorView, sectionId: string): EditorSection | null {
  const { sections } = view.state.field(sectionField);
  return sections.find((s) => s.id === sectionId) ?? null;
}

/** Parse the content inside the fences and return ICodeStatements. */
function parseContent(view: EditorView, section: EditorSection): ICodeStatement[] {
  if (section.contentFrom === undefined || section.contentTo === undefined) return [];
  const raw = view.state.doc.sliceString(section.contentFrom, section.contentTo);
  if (!raw.trim()) return [];
  try {
    return parser.read(raw, section.sport).statements as ICodeStatement[];
  } catch {
    return [];
  }
}

/**
 * Find the statement at the cursor's line within the block.
 * `cursorDocLine` is the 1-based absolute line number in the full document.
 * Content lines start at `section.startLine + 1`.
 */
function findActiveStatement(
  statements: ICodeStatement[],
  section: EditorSection,
  cursorDocLine: number,
): ICodeStatement | null {
  if (!statements.length) return null;
  // 1-based line within the content string
  const lineInContent = cursorDocLine - section.startLine;  // startLine = fence line
  return statements.find((s) => s.meta?.line === lineInContent) ?? null;
}

/** Format milliseconds as M:SS or H:MM:SS */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ── Metric chip data ─────────────────────────────────────────────────

interface MetricChip {
  label: string;
  value: string;
  icon: string;
  color: string;
}

const METRIC_CONFIG: Partial<Record<string, { label: string; icon: string; color: string }>> = {
  [MetricType.Duration]:  { label: "Timer",    icon: "⏱",  color: "bg-metric-time/10 text-metric-time" },
  [MetricType.Rep]:       { label: "Reps",     icon: "✕",  color: "bg-metric-rep/10 text-metric-rep" },
  [MetricType.Effort]:    { label: "Exercise", icon: "🏋",  color: "bg-metric-effort/10 text-metric-effort" },
  [MetricType.Rounds]:    { label: "Rounds",   icon: "↻",  color: "bg-metric-rounds/10 text-metric-rounds" },
  [MetricType.Distance]:  { label: "Distance", icon: "📏", color: "bg-metric-distance/10 text-metric-distance" },
  [MetricType.Resistance]:{ label: "Weight",   icon: "⚖",  color: "bg-metric-resistance/10 text-metric-resistance" },
  [MetricType.Action]:    { label: "Action",   icon: "⚡",  color: "bg-metric-action/10 text-metric-action" },
};

function metricChips(statement: ICodeStatement): MetricChip[] {
  return statement.metrics
    .filter((m) => m.type !== MetricType.Sound && m.type !== MetricType.System)
    .map((m) => {
      const cfg = METRIC_CONFIG[m.type as string];
      const displayVal = m.image ?? (m.value !== undefined ? String(m.value) : "—");
      return {
        label: cfg?.label ?? String(m.type),
        value: displayVal,
        icon: cfg?.icon ?? "•",
        color: cfg?.color ?? "bg-muted text-muted-foreground",
      };
    });
}

// ── Line Execution Summary Card ──────────────────────────────────────

const LineExecutionSummaryCard: React.FC<{ summary: LineExecutionSummary }> = ({ summary }) => {
  // Show at most the 3 most recent entries
  const recent = summary.entries.slice(0, 3);
  return (
    <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Activity className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">History</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {summary.totalHits}× across {summary.resultCount} run{summary.resultCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {recent.map((entry) => (
          <div
            key={entry.createdAt}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background/60 border border-border/40 text-[10px]"
          >
            <span className="font-mono font-medium text-foreground">{formatDuration(entry.elapsedMs)}</span>
            {entry.hitCount > 1 && (
              <span className="text-muted-foreground">×{entry.hitCount}</span>
            )}
            <span className="text-muted-foreground/60">
              {formatDateShort(new Date(entry.createdAt))}
            </span>
          </div>
        ))}
        {summary.entries.length > 3 && (
          <span className="text-[10px] text-muted-foreground self-center">+{summary.entries.length - 3} more</span>
        )}
      </div>
    </div>
  );
};

// ── Block resolver ────────────────────────────────────────────────────

function buildScriptBlock(view: EditorView, section: EditorSection): ScriptBlock {
  const content =
    section.contentFrom !== undefined && section.contentTo !== undefined
      ? view.state.doc.sliceString(section.contentFrom, section.contentTo)
      : "";
  const dialect: FenceDialect =
    section.type === "time" || section.type === "log" ? section.type : "time";
  return {
    id: section.id,
    contentId: section.contentId,
    dialect,
    sport: section.sport,
    startLine: section.startLine - 1,
    endLine: section.endLine - 1,
    content,
    state: "idle",
    version: 1,
    createdAt: Date.now(),
    widgetIds: {},
  };
}

// ── Icon adapter ─────────────────────────────────────────────────────

/** Wraps a ReactNode into a ComponentType compatible with INavActivation. */
function wrapNodeAsIcon(
  node: React.ReactNode,
): React.ComponentType<{ className?: string }> {
  return function WrappedIcon({ className }: { className?: string }) {
    if (React.isValidElement(node)) {
      return React.cloneElement(
        node as React.ReactElement<{ className?: string }>,
        { className: cn((node.props as { className?: string }).className, className) },
      );
    }
    return <span className={cn("flex items-center", className)}>{node}</span>;
  };
}

// ── CommandPill ───────────────────────────────────────────────────────
/** Renders a single ScriptCommand as a Button or ButtonGroup molecule. */
const CommandPill: React.FC<{
  cmd: ScriptCommand;
  block: ScriptBlock;
}> = ({ cmd, block }) => {
  const [splitOk, setSplitOk] = useState(false);

  const handleSplitAction = useCallback(async () => {
    if (!cmd.onSplitClick || splitOk) return;
    await cmd.onSplitClick(block);
    setSplitOk(true);
    setTimeout(() => setSplitOk(false), 1500);
  }, [cmd, block, splitOk]);

  const PrimaryIcon = useMemo(() => wrapNodeAsIcon(cmd.icon), [cmd.icon]);
  const SplitIcon = useMemo(
    () =>
      splitOk
        ? wrapNodeAsIcon(cmd.splitSuccessIcon ?? cmd.splitIcon)
        : wrapNodeAsIcon(cmd.splitIcon),
    [splitOk, cmd.splitIcon, cmd.splitSuccessIcon],
  );

  const primaryActivation = useMemo<INavActivation>(
    () => ({
      id: cmd.id,
      label: cmd.label,
      icon: PrimaryIcon,
      action: { type: "call", handler: () => cmd.onClick(block) },
    }),
    [cmd, block, PrimaryIcon],
  );

  const secondaryActivation = useMemo<INavActivation>(
    () => ({
      id: `${cmd.id}-split`,
      label: "Copy link",
      icon: SplitIcon,
      action: { type: "call", handler: handleSplitAction },
    }),
    [cmd.id, SplitIcon, handleSplitAction],
  );

  const stopEvent = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!cmd.onSplitClick) {
    return (
      <Button
        variant={cmd.primary ? "default" : "secondary"}
        className={cn(
          "scroll-mt-20 h-11 w-11 rounded-full p-0 text-[10px] font-medium shadow-sm gap-0 sm:h-auto sm:min-h-[44px] sm:w-auto sm:gap-1 sm:rounded-sm sm:px-2 sm:py-0.5",
          !cmd.primary && "border border-border/50",
        )}
        title={cmd.label}
        aria-label={cmd.label}
        data-testid={cmd.id === "run" || cmd.id === "play" ? TEST_IDS.EDITOR_START_WORKOUT : undefined}
        onClick={(e) => { stopEvent(e); cmd.onClick(block); }}
        onMouseDown={stopEvent}
        onPointerDown={stopEvent}
      >
        <span className="flex items-center justify-center size-4 sm:size-3">{cmd.icon}</span>
        <span className="sr-only sm:not-sr-only sm:inline">{cmd.label}</span>
      </Button>
    );
  }

  return (
    <div onClick={stopEvent} onMouseDown={stopEvent} onPointerDown={stopEvent}>
      <ButtonGroup
        primary={primaryActivation}
        secondary={secondaryActivation}
        size="xs"
        variant={cmd.primary ? "primary" : "default"}
        className="rounded-full sm:rounded-sm"
        labelClassName="sr-only sm:not-sr-only sm:inline"
      />
    </div>
  );
};

// ── CommandButtons ────────────────────────────────────────────────────
/**
 * Renders a row of command buttons.
 * Labels are hidden on small screens via `hidden sm:inline` inside CommandPill.
 */
const CommandButtons: React.FC<{
  commands: ScriptCommand[];
  section: EditorSection;
  view: EditorView;
  compact?: boolean;
}> = ({ commands, section, view, compact }) => {
  if (!commands.length) return null;

  const block = buildScriptBlock(view, section);

  if (compact) {
    return (
      <div className="flex flex-row items-center gap-1 p-0 sm:p-1.5">
        {commands.map((cmd) => (
          <CommandPill key={cmd.id} cmd={cmd} block={block} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 p-2 border-t border-border/50 flex-wrap">
      {commands.map((cmd) => (
        <CommandPill key={cmd.id} cmd={cmd} block={block} />
      ))}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────

export interface WhiteboardCompanionProps {
  /** Note ID for results lookup */
  noteId?: string;
  sectionId: string;
  view: EditorView;
  isActive: boolean;
  widthPercent: number;
  /** Absolute 1-based document line number of the cursor (for metric lookup). */
  cursorLine: number;
  /** Absolute 1-based document line number the mouse is hovering over (may be undefined when mouse is over the panel itself). */
  hoverLine?: number;
  /** How many px the section top has scrolled above the viewport. */
  stickyTopOffset: number;
  /** True while the mouse is physically over the slot (keeps card pinned). */
  isPanelHovered: boolean;
  /** Document-space Y midpoint of cursor/hover line (for card centering). */
  lineDocY?: number;
  /** Section rect — used for card position clamping. */
  rect: import('@bitcobblers/wod-wiki-ui/extensions').SectionRect;
  /** Increments on every document change — forces re-parse on content edits. */
  docVersion: number;
  /** Commands to display as action buttons. */
  commands: ScriptCommand[];
  /** In-memory results fallback */
  extendedResults?: Session[];
}

export const WhiteboardCompanion: React.FC<WhiteboardCompanionProps> = ({
  noteId: propNoteId,
  sectionId,
  view,
  isActive,
  cursorLine,
  hoverLine,
  stickyTopOffset,
  isPanelHovered,
  lineDocY,
  rect,
  docVersion,
  commands,
  extendedResults,
}) => {
  const noteId = propNoteId || (view.state as unknown as { noteId?: string }).noteId || "current";
  const section = useMemo(
    () => getSection(view, sectionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, sectionId, docVersion],
  );
  const { results } = useScriptBlockResults(noteId, sectionId, extendedResults, section?.contentId);

  const statements = useMemo(
    () => (section ? parseContent(view, section) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, section?.id, docVersion],
  );

  // Track last valid hoverLine inside this section so the card doesn't blank
  // when the mouse moves from editor text into the panel itself.
  const lastHoverLineRef = React.useRef<number | null>(null);
  const hoverInsideSection = section && hoverLine !== undefined
    && hoverLine >= section.startLine
    && hoverLine <= section.endLine;
  if (hoverInsideSection && hoverLine !== undefined) {
    lastHoverLineRef.current = hoverLine;
  }

  // Use remembered line when panel is hovered but hoverLine dropped off
  const effectiveHoverLine = hoverInsideSection
    ? hoverLine!
    : (isPanelHovered ? (lastHoverLineRef.current ?? null) : null);

  const effectiveLine = isActive ? cursorLine : (effectiveHoverLine ?? cursorLine);

  // Don't show the card when on the opening ```time or closing ``` fence lines
  const onFenceLine = section
    ? effectiveLine === section.startLine || effectiveLine === section.endLine
    : false;
  const showCard = !onFenceLine && (isActive || effectiveHoverLine !== null);

  const activeStatement = useMemo(
    () => (section && showCard ? findActiveStatement(statements, section, effectiveLine) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, effectiveLine, showCard, statements],
  );

  const chips = useMemo(
    () => activeStatement ? statements.filter(s => s.meta?.line === activeStatement.meta.line).flatMap(metricChips) : [],
    [activeStatement, statements],
  );

  const lineSummary = useScriptLineResults(results, activeStatement?.meta?.line);

  if (!section) return null;

  const lineText = (activeStatement?.meta as unknown as { raw?: string } | undefined)?.raw ?? "";
  const lineInContent = effectiveLine - section.startLine;

  // The slot is full-height and transparent. We render two absolute children:
  //  1. STRIP — always visible, sticky to top of viewport within section bounds
  //  2. CARD  — compact metric panel, shown on hover/active, positioned below strip

  const isMobileViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
  const STRIP_H = isMobileViewport ? 44 : 28;
  const CARD_H  = 200;

  // Card top: centered on the active line, but clamped to stay within the slot
  // and below the sticky strip. lineDocY is document-space, rect.top is slot top.
  let cardTop: number;
  if (lineDocY !== undefined) {
    const lineRelY = lineDocY - rect.top;              // line Y relative to slot top
    const centered = lineRelY - CARD_H / 2;           // center card on line
    const minTop = stickyTopOffset + STRIP_H + 4;     // must be below strip
    const maxTop = rect.height - CARD_H;              // must not overflow slot bottom
    cardTop = Math.max(minTop, Math.min(centered, Math.max(minTop, maxTop)));
  } else {
    cardTop = stickyTopOffset + STRIP_H + 4;          // fallback: just below strip
  }

  return (
    <div className="relative w-full h-full" style={{ pointerEvents: "none" }}>

      {/* ── STRIP: always visible, sticky-top ────────────────────── */}
      <div
        className="absolute inset-x-0 flex items-center justify-end gap-1 px-2 pointer-events-auto
                   bg-background/70 backdrop-blur-sm border-l border-b border-border/40 rounded-bl-md"
        style={{ top: stickyTopOffset, height: STRIP_H }}
      >
        <div className="flex items-center gap-1.5">
          {results.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 shadow-sm">
                <History className="h-3 w-3" />
                <span>{results.length}</span>
              </div>
              <div className="h-3 w-[1px] bg-border/40 mx-0.5" />
            </>
          )}
          <CommandButtons
            commands={commands}
            section={section}
            view={view}
            compact
          />
        </div>
      </div>

      {/* ── CARD: compact metric panel on hover / cursor ─────────── */}
      {showCard && (
        <div
          className="absolute inset-x-0 flex flex-col bg-popover/95 backdrop-blur-md
                     border border-border/80 shadow-xl rounded-lg overflow-hidden pointer-events-auto"
          style={{ top: cardTop, maxHeight: CARD_H }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/50 shrink-0">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-metric-time/10 text-metric-time uppercase tracking-wider font-semibold">
              {section.type}
            </span>
            <div className="flex items-center min-w-0 gap-2">
              <span className="text-xs text-muted-foreground/60">L{lineInContent}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs font-mono text-foreground/90 truncate font-medium" title={lineText}>
                {lineText || <span className="italic text-muted-foreground">—</span>}
              </span>
            </div>
          </div>

          {/* Metric chips */}
          <div className="px-3 py-2.5 min-h-0 overflow-auto">
            {chips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {chips.map((chip, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-semibold ${chip.color}`}
                    title={chip.label}
                  >
                    <span className="text-base leading-none">{chip.icon}</span>
                    <span className="font-mono tracking-tight">{chip.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs italic text-muted-foreground">No metrics on this line</span>
            )}
          </div>

          {/* Line execution history */}
          {lineSummary && <LineExecutionSummaryCard summary={lineSummary} />}

          {/* Action buttons */}
          <div className="border-t border-border/40 shrink-0">
            <CommandButtons commands={commands} section={section} view={view} />
          </div>
        </div>
      )}
    </div>
  );
};

