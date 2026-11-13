/**
 * InlineCommandBar
 *
 * Utilitarian Minimalism command buttons rendered at the opening fence of each
 * workout block when enableOverlay is false. Keeps Run / Playground / Plan
 * controls crisp, flat (1px border, 5px radius), and accessible on both
 * desktop and mobile.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { sectionField, type EditorSection } from "@bitcobblers/wod-wiki-ui/extensions";
import { sectionGeometry as sectionGeometryPlugin, type SectionRect } from "@bitcobblers/wod-wiki-ui/extensions";
import { commandsForAffordance, type ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import type { ScriptBlock, FenceDialect } from "@/components/Editor/types";
import { runAffordance } from "@/components/Editor/types/section";
import { cn } from "@/lib/utils";
import { Button } from "@/components/atoms/primitives/button";
import { ButtonGroup } from "@/components/molecules/ButtonGroup";
import type { INavActivation } from "@/nav/navTypes";
import { TEST_IDS } from "@/lib/testIds";

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

  if (!cmd.onSplitClick) {
    const currentIcon = actionOk ? (cmd.successIcon ?? cmd.icon) : cmd.icon;
    return (
      <Button
        variant={cmd.primary ? "default" : "secondary"}
        className={cn(
          "pointer-events-auto scroll-mt-20",
          cmd.iconOnly
            ? "h-8 min-w-[34px] rounded-[5px] px-2 py-0.5 text-[11px] font-medium shadow-none"
            : "h-8 rounded-[5px] px-2.5 py-0.5 text-[11px] font-medium shadow-none gap-1.5",
          cmd.primary
            ? "bg-foreground text-background hover:bg-foreground/90 border border-foreground"
            : "bg-card text-foreground hover:bg-muted border border-border",
          actionOk &&
            "text-success bg-success/15 border-success/30",
        )}
        title={cmd.label}
        aria-label={cmd.label}
        data-testid={cmd.id === "run" || cmd.id === "play" ? TEST_IDS.EDITOR_START_WORKOUT : undefined}
        onClick={(e) => {
          stopEvent(e);
          handleAction();
        }}
        onMouseDown={stopEvent}
        onPointerDown={stopEvent}
      >
        <span className="flex items-center justify-center size-3.5">{currentIcon}</span>
        {!cmd.iconOnly && <span>{cmd.label}</span>}
      </Button>
    );
  }

  return (
    <div
      className="pointer-events-auto scroll-mt-20"
      onClick={stopEvent}
      onMouseDown={stopEvent}
      onPointerDown={stopEvent}
    >
      <ButtonGroup
        primary={primaryActivation}
        secondary={secondaryActivation}
        size="xs"
        variant={cmd.primary ? "primary" : "default"}
        className="rounded-[5px] shadow-none"
        labelClassName="sr-only sm:not-sr-only sm:inline"
      />
    </div>
  );
};

interface InlineCommandBarProps {
  view: EditorView | null;
  commands: ScriptCommand[];
}

export const InlineCommandBar: React.FC<InlineCommandBarProps> = ({
  view,
  commands,
}) => {
  const [rects, setRects] = useState<SectionRect[]>(() => view?.plugin(sectionGeometryPlugin)?.rects ?? []);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!view) return;
    const plugin = view.plugin(sectionGeometryPlugin);
    if (!plugin) return;

    setRects([...plugin.rects]);
    return plugin.addListener((newRects: SectionRect[]) =>
      setRects([...newRects]),
    );
  }, [view]);

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
    scroller.addEventListener("scroll", onScroll, { passive: true });
    setScrollTop(scroller.scrollTop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [view]);

  const plugin = view ? view.plugin(sectionGeometryPlugin) : null;
  const currentRects = rects.length > 0 ? rects : (plugin?.rects ?? []);

  const workoutRects = currentRects.filter(
    (r) => r.type === "time" || r.type === "log",
  );

  if (workoutRects.length === 0 || !view) return null;
  const { sections } = view.state.field(sectionField);
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  const contentOffsetTop =
    (view.dom?.offsetTop ?? 0) +
    (view.scrollDOM?.offsetTop ?? 0) +
    (view.contentDOM?.offsetTop ?? 0);

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
            className="absolute right-1.5 z-20 flex items-end gap-1 pb-0.5 pointer-events-none"
            style={{
              top: contentOffsetTop + rect.top - scrollTop,
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
