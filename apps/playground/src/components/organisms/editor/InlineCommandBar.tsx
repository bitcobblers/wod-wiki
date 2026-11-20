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
import { MoreHorizontal } from "lucide-react";
import { sectionField, type EditorSection } from "@bitcobblers/wod-wiki-ui/extensions";
import { sectionGeometry as sectionGeometryPlugin, type SectionRect } from "@bitcobblers/wod-wiki-ui/extensions";
import { commandsForAffordance, type ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import type { ScriptBlock, FenceDialect } from "@/components/Editor/types";
import { runAffordance } from "@/components/Editor/types/section";
import { cn } from "@/lib/utils";
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
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
      action: { type: "call", handler: () => { void handleAction(); } },
    }),
    [cmd.id, cmd.label, PrimaryIcon, handleAction],
  );

  const secondaryActivation = useMemo<INavActivation>(
    () => ({
      id: `${cmd.id}-split`,
      label: "Copy link",
      icon: SplitIcon,
      action: { type: "call", handler: () => { void handleSplitAction(); } },
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
          void handleAction();
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
  const [containerWidth, setContainerWidth] = useState<number>(() => view?.dom?.clientWidth ?? 640);
  const [openOverflowSectionId, setOpenOverflowSectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!view) return;
    const dom = view.dom;
    const syncWidth = () => {
      const next = dom?.clientWidth ?? 640;
      if (next > 0) setContainerWidth(next);
    };
    syncWidth();
    if (typeof ResizeObserver === "undefined" || !dom) return;
    const ro = new ResizeObserver(syncWidth);
    ro.observe(dom);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => {
    if (!openOverflowSectionId) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-inline-cmd-overflow-root="true"]')) {
        return;
      }
      setOpenOverflowSectionId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOverflowSectionId(null);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openOverflowSectionId]);

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
  const isNarrow = containerWidth > 0 && containerWidth < 520;

  return (
    <>
      {workoutRects.map((rect) => {
        const section = sectionMap.get(rect.sectionId);
        if (!section) return null;

        const block = buildScriptBlock(view, section);
        const affordance = runAffordance(section.type);
        const visibleCommands = commandsForAffordance(commands, affordance);
        if (visibleCommands.length === 0) return null;

        const primaryCmd = isNarrow
          ? (visibleCommands.find((c) => c.primary) ?? visibleCommands[0])
          : null;
        const overflowCmds = isNarrow && primaryCmd
          ? visibleCommands.filter((c) => c !== primaryCmd)
          : [];
        const isOverflowOpen = openOverflowSectionId === rect.sectionId;

        return (
          <div
            key={rect.sectionId}
            className="absolute right-1.5 z-20 flex items-center gap-1 pointer-events-none"
            style={{
              top: contentOffsetTop + rect.top - scrollTop,
              height: Math.max(30, Math.min(rect.firstLineHeight, 36)),
            }}
          >
            {!isNarrow || !primaryCmd ? (
              visibleCommands.map((cmd) => (
                <CommandPill key={cmd.id} cmd={cmd} block={block} />
              ))
            ) : (
              <>
                <CommandPill cmd={primaryCmd} block={block} />
                {overflowCmds.length > 0 && (
                  <div className="relative pointer-events-auto" data-inline-cmd-overflow-root="true">
                    <Button
                      variant="secondary"
                      type="button"
                      data-testid={TEST_IDS.EDITOR_OVERFLOW_ACTIONS_BTN}
                      aria-label="More block actions"
                      aria-expanded={isOverflowOpen}
                      className="h-8 max-lg:min-h-[44px] min-w-[36px] max-lg:min-w-[44px] rounded-[5px] px-2 text-foreground bg-card hover:bg-muted border border-border shadow-none"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenOverflowSectionId((prev) =>
                          prev === rect.sectionId ? null : rect.sectionId,
                        );
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {isOverflowOpen && (
                      <div
                        role="menu"
                        aria-label="Block actions"
                        data-testid={TEST_IDS.EDITOR_OVERFLOW_ACTIONS_MENU}
                        className="absolute right-0 top-full mt-1 z-40 min-w-[168px] rounded-[6px] border border-border bg-card p-1 shadow-md flex flex-col gap-0.5"
                      >
                        {overflowCmds.map((cmd) => (
                          <React.Fragment key={cmd.id}>
                            <button
                              type="button"
                              role="menuitem"
                              className="w-full min-h-[36px] max-lg:min-h-[44px] px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 text-left text-xs font-medium text-foreground hover:bg-muted transition-colors"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpenOverflowSectionId(null);
                                void cmd.onClick(block);
                              }}
                            >
                              <span className="flex items-center justify-center size-3.5 text-muted-foreground">
                                {cmd.icon}
                              </span>
                              <span>{cmd.label}</span>
                            </button>
                            {cmd.onSplitClick && (
                              <button
                                type="button"
                                role="menuitem"
                                className="w-full min-h-[36px] max-lg:min-h-[44px] px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 text-left text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOpenOverflowSectionId(null);
                                  void cmd.onSplitClick?.(block);
                                }}
                              >
                                <span className="flex items-center justify-center size-3.5 text-muted-foreground">
                                  {cmd.splitIcon ?? cmd.icon}
                                </span>
                                <span>Copy share link</span>
                              </button>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
};
