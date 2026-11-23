/**
 * InlineCommandBar
 *
 * Utilitarian Minimalism command buttons rendered at the opening fence of each
 * workout block when enableOverlay is false. Keeps Run / Playground / Plan
 * controls crisp, flat (1px border, 5px radius), and accessible on both
 * desktop and mobile.
 */

import React, { useEffect, useState, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import { MoreHorizontal } from "lucide-react";
import { sectionField, type EditorSection } from "@bitcobblers/wod-wiki-ui/extensions";
import { sectionGeometry as sectionGeometryPlugin, type SectionRect } from "@bitcobblers/wod-wiki-ui/extensions";
import { commandsForAffordance, type ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import type { ScriptBlock, FenceDialect } from "@/components/Editor/types";
import { runAffordance } from "@/components/Editor/types/section";
import { cn } from "@/lib/utils";
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
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

  const stopEvent = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const currentIcon = actionOk ? (cmd.successIcon ?? cmd.icon) : cmd.icon;

  if (!cmd.onSplitClick) {
    return (
      <Button
        variant={cmd.primary ? "default" : "outline"}
        className={cn(
          "pointer-events-auto scroll-mt-20 h-7 max-lg:h-11 max-lg:min-h-[44px] py-0 rounded-[6px] text-xs font-medium shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          cmd.iconOnly
            ? "w-7 max-lg:w-11 max-lg:min-w-[44px] px-0"
            : "px-2.5 max-lg:px-3.5 gap-1.5",
          cmd.primary
            ? "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary/90"
            : "bg-card/85 text-muted-foreground hover:bg-card hover:text-foreground border border-border/80",
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
        <span className="flex items-center justify-center size-3.5 shrink-0">{currentIcon}</span>
        {!cmd.iconOnly && <span>{cmd.label}</span>}
      </Button>
    );
  }

  const currentSplitIcon = splitOk
    ? (cmd.splitSuccessIcon ?? cmd.splitIcon)
    : cmd.splitIcon;

  return (
    <div
      className={cn(
        "pointer-events-auto scroll-mt-20 inline-flex items-stretch overflow-hidden rounded-[6px] border shadow-none",
        cmd.primary
          ? "border-primary/90 bg-primary"
          : "border-border/80 bg-card/85",
      )}
      onMouseDown={stopEvent}
      onPointerDown={stopEvent}
    >
      <button
        type="button"
        title={cmd.label}
        aria-label={cmd.label}
        onClick={(e) => {
          stopEvent(e);
          void handleAction();
        }}
        className={cn(
          "h-7 max-lg:h-11 max-lg:min-h-[44px] inline-flex items-center gap-1.5 px-2.5 max-lg:px-3 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          cmd.primary
            ? "text-primary-foreground hover:bg-primary/90"
            : "text-muted-foreground hover:bg-card hover:text-foreground",
          actionOk && "text-success bg-success/10",
        )}
      >
        <span className="flex items-center justify-center size-3.5 shrink-0">{currentIcon}</span>
        <span className="sr-only sm:not-sr-only sm:inline">{cmd.label}</span>
      </button>
      <span
        aria-hidden="true"
        className={cn(
          "w-px self-stretch",
          cmd.primary ? "bg-primary-foreground/25" : "bg-border/70",
        )}
      />
      <button
        type="button"
        title="Copy link"
        aria-label="Copy link"
        onClick={(e) => {
          stopEvent(e);
          void handleSplitAction();
        }}
        className={cn(
          "h-7 w-7 max-lg:h-11 max-lg:w-11 max-lg:min-h-[44px] max-lg:min-w-[44px] inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          cmd.primary
            ? "text-primary-foreground hover:bg-primary/90"
            : "text-muted-foreground hover:bg-card hover:text-foreground",
          splitOk && "text-success bg-success/10",
        )}
      >
        <span className="flex items-center justify-center size-3.5 shrink-0">{currentSplitIcon}</span>
      </button>
    </div>
  );
};

function areSectionRectsEqual(a: SectionRect[], b: SectionRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.sectionId !== y.sectionId ||
      x.top !== y.top ||
      x.height !== y.height ||
      x.firstLineHeight !== y.firstLineHeight ||
      x.type !== y.type
    ) {
      return false;
    }
  }
  return true;
}

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

    const commitRects = (nextRects: SectionRect[]) => {
      const hasWorkoutRects = nextRects.some((r) => r.type === "time" || r.type === "log");
      if (!hasWorkoutRects) {
        const hasWorkoutSections =
          view.state.field(sectionField, false)?.sections.some(
            (s) => s.type === "time" || s.type === "log",
          ) ?? false;
        if (hasWorkoutSections) return;
      }
      setRects((prev) => (areSectionRectsEqual(prev, nextRects) ? prev : [...nextRects]));
    };

    commitRects(plugin.rects);
    return plugin.addListener((newRects: SectionRect[]) => commitRects(newRects));
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
            className="absolute right-2.5 z-20 flex items-center gap-1.5 pointer-events-none"
            style={{
              top: contentOffsetTop + rect.top - scrollTop,
              height: Math.max(36, Math.min(rect.firstLineHeight ?? 40, 64)),
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
                      variant="outline"
                      type="button"
                      data-testid={TEST_IDS.EDITOR_OVERFLOW_ACTIONS_BTN}
                      aria-label="More block actions"
                      aria-expanded={isOverflowOpen}
                      className="h-7 w-7 max-lg:h-11 max-lg:w-11 max-lg:min-h-[44px] max-lg:min-w-[44px] rounded-[6px] px-0 py-0 text-muted-foreground hover:text-foreground bg-card/85 hover:bg-card border border-border/80 shadow-none"
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
