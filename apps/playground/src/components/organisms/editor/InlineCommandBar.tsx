/**
 * InlineCommandBar
 *
 * Lightweight command buttons rendered at the opening fence of each workout block
 * when enableOverlay is false.  This ensures Run / Playground / Plan buttons
 * remain accessible even without the full overlay panel.
 *
 * Uses the sectionField (already in the editor state) and section-geometry
 * rects to position a floating toolbar at the top-right of each workout section.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { sectionField, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { sectionGeometry as sectionGeometryPlugin, type SectionRect } from '@bitcobblers/wod-wiki-ui/extensions';
import { commandsForAffordance, type ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import type { ScriptBlock, FenceDialect } from '@/components/Editor/types';
import { runAffordance } from '@/components/Editor/types/section';
import { cn } from "@/lib/utils";
import { Button } from "@/components/atoms/primitives/button";
import { ButtonGroup } from "@/components/molecules/ButtonGroup";
import type { INavActivation } from "@/nav/navTypes";
import { TEST_IDS } from "@/lib/testIds";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a ScriptBlock from section data (matches WhiteboardCompanion's buildScriptBlock). */
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

/**
 * Wraps a ReactNode icon into a ComponentType compatible with INavActivation.
 * If the node is a cloneable React element, the className from ButtonGroup is
 * merged in so icon sizing/color remain controllable.
 */
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

// ── CommandPill ──────────────────────────────────────────────────────

const CommandPill: React.FC<{
  cmd: ScriptCommand;
  block: ScriptBlock;
}> = ({ cmd, block }) => {
  const [splitOk, setSplitOk] = useState(false);
  const [actionOk, setActionOk] = useState(false);

  const handleSplitAction = useCallback(async () => {
    if (!cmd.onSplitClick || splitOk) return;
    await cmd.onSplitClick(block);
    setSplitOk(true);
    setTimeout(() => setSplitOk(false), 1500);
  }, [cmd, block, splitOk]);

  const handleAction = useCallback(async () => {
    if (actionOk) return;
    await cmd.onClick(block);
    if (cmd.successIcon) {
      setActionOk(true);
      setTimeout(() => setActionOk(false), 1500);
    }
  }, [cmd, block, actionOk]);

  const PrimaryIcon = useMemo(
    () => wrapNodeAsIcon(actionOk ? (cmd.successIcon ?? cmd.icon) : cmd.icon),
    [cmd.icon, cmd.successIcon, actionOk],
  );
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
      action: { type: "call", handler: () => handleAction() },
    }),
    [cmd.id, cmd.label, PrimaryIcon, handleAction],
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

  // Standalone button — no split action
  if (!cmd.onSplitClick) {
    const currentIcon = actionOk ? (cmd.successIcon ?? cmd.icon) : cmd.icon;
    return (
      <Button
        variant={cmd.primary ? "default" : "secondary"}
        className={cn(
          cmd.iconOnly
            ? "h-11 w-11 rounded-full p-0 sm:h-auto sm:min-h-[44px] sm:min-w-[44px] sm:w-auto sm:rounded-sm sm:px-1.5 sm:py-0.5 text-[10px] font-medium shadow-sm"
            : "h-11 w-11 rounded-full p-0 text-[10px] font-medium shadow-sm gap-0 sm:h-auto sm:min-h-[44px] sm:w-auto sm:gap-1 sm:rounded-sm sm:px-2 sm:py-0.5",
          !cmd.primary && "border border-border/50",
          actionOk && "text-emerald-600 bg-emerald-500/15 dark:text-emerald-400 dark:bg-emerald-500/20 border-emerald-500/30",
        )}
        title={cmd.label}
        aria-label={cmd.label}
        data-testid={cmd.id === 'run' ? TEST_IDS.EDITOR_START_WORKOUT : undefined}
        onClick={(e) => {
          stopEvent(e);
          handleAction();
        }}
        onMouseDown={stopEvent}
        onPointerDown={stopEvent}
      >
        <span className="flex items-center justify-center size-4 sm:size-3">{currentIcon}</span>
        {!cmd.iconOnly && <span className="sr-only sm:not-sr-only sm:inline">{cmd.label}</span>}
      </Button>
    );
  }

  // Split button: primary action + secondary icon via ButtonGroup
  return (
    <div
      onClick={stopEvent}
      onMouseDown={stopEvent}
      onPointerDown={stopEvent}
    >
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

// ── InlineCommandBar ─────────────────────────────────────────────────

interface InlineCommandBarProps {
  /** The CodeMirror EditorView instance */
  view: EditorView | null;
  /** Command definitions (Run, Playground, Plan, …) */
  commands: ScriptCommand[];
}

/**
 * Renders a floating command bar at the top-right of every workout section.
 *
 * The component listens to section-geometry updates (which fire on scroll,
 * viewport change, and document change) and positions one toolbar per workout
 * block.
 */
export const InlineCommandBar: React.FC<InlineCommandBarProps> = ({
  view,
  commands,
}) => {
  const [rects, setRects] = useState<SectionRect[]>(() => view?.plugin(sectionGeometryPlugin)?.rects ?? []);
  const [scrollTop, setScrollTop] = useState(0);

  // Subscribe to geometry changes from the CM6 plugin
  useEffect(() => {
    if (!view) return;

    const plugin = view.plugin(sectionGeometryPlugin);
    if (!plugin) return;

    setRects([...plugin.rects]);
    const _unsubscribe = plugin.addListener((newRects: SectionRect[]) =>
      setRects([...newRects]),
    );
  }, [view]);

  // Track cm-scroller scroll to compensate rect.top (document-space) for scroll offset.
  // RAF-throttled to prevent a setState on every scroll pixel.
  useEffect(() => {
    if (!view) return;
    const scroller = view.scrollDOM;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setScrollTop(scroller.scrollTop);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(scroller.scrollTop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [view]);
  const plugin = view ? view.plugin(sectionGeometryPlugin) : null;
  const currentRects = rects.length > 0 ? rects : (plugin?.rects ?? []);

  // Only render for workout (time/log) sections
  const workoutRects = currentRects.filter(
    (r) => r.type === "time" || r.type === "log"
  );

  if (workoutRects.length === 0) return null;
  const { sections } = view.state.field(sectionField);
  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  return (
    <>
      {workoutRects.map((rect) => {
        const section = sectionMap.get(rect.sectionId);
        if (!section) return null;

        const block = buildScriptBlock(view, section);
        const affordance = runAffordance(section.type);
        const visibleCommands = commandsForAffordance(commands, affordance);
        if (visibleCommands.length === 0) return null;
        return (
          <div
            key={rect.sectionId}
            className="absolute right-1 z-10 flex items-end gap-1 pointer-events-auto"
            style={{
              // rect.top is document-space; subtract scrollTop to get the correct
              // position relative to .cm-note-editor as the editor scrolls.
              // Fill the (padded) fence line and bottom-align so the buttons
              // can't cover the previous line or the block's first content line.
              top: rect.top - scrollTop,
              height: rect.firstLineHeight,
            }}
          >
            {visibleCommands.map((cmd) => (
              <CommandPill key={cmd.id} cmd={cmd} block={block} />
            ))}
          </div>
        );
      })}
    </>
  );
};

