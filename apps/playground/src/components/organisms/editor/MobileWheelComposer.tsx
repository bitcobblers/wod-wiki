/**
 * MobileWheelComposer — Unified 3-Region Mobile Thumb Deck for <1024px authoring.
 *
 * Regions:
 *  1. Live Token Rail: prev/next arrows, parsed tokens + "+ Add", lint quick-fixes, Block settings
 *  2. Unified Contextual Body: TokenInspectorPanel (with optional 50cqh TokenScrubber), or +Add grid
 *  3. Pinned 44px Footer: Undo, Delete, + Line, Type, Done
 *
 * Keeps semantic Tailwind tokens (Light Mineral / Dark Arctic Frost) and preserves a persistent
 * Live Token Rail + syntax accessory keys above the OS keyboard when switched to Type mode.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";
import { indentLess, indentMore, undo } from "@codemirror/commands";
import {
  ArrowCounterClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  KeyboardIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TextIndentIcon,
  TextOutdentIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { TEST_IDS } from "@/lib/testIds";
import { cn } from "@/lib/utils";
import {
  buildWheelComposerModel,
  loadNotebookScopeSnapshot,
  type NotebookScopeSnapshot,
  type WheelDrumOption,
  type WheelDrumSpec,
  type WheelSlot,
} from "./wheelSources";
import { TokenInspectorPanel } from "./whiteboard-inspector/TokenInspectorPanel";
import {
  applyQuickFixInView,
  deleteTokenInView,
  extractLineTokens,
  parseDistanceToken,
  parseDurationToken,
  parseResistanceToken,
  type InspectorMode,
  type InspectorToken,
  type InspectorTokenKind,
} from "./whiteboard-inspector/tokenModel";
import { revealMobileEditRow } from "./mobileEditViewport";

export interface MobileWheelComposerProps {
  view: EditorView | null;
  noteId?: string;
  cursorVersion: number;
  isOpen: boolean;
  isTypingMode: boolean;
  onSwitchToTyping: (typing: boolean) => void;
  onDeckInteract?: () => void;
  onClose: () => void;
}

const EMPTY_SCOPE: NotebookScopeSnapshot = {
  tags: [],
  defaultEquipment: [],
  customMetricTypes: [],
};

const SYNTAX_KEYS: ReadonlyArray<{
  label: string;
  ariaLabel: string;
  insert: string;
  cursorOffset?: number;
  triggerComplete?: boolean;
}> = [
  { label: "#", ariaLabel: "Insert tag prefix #", insert: "#", triggerComplete: true },
  { label: "@", ariaLabel: "Insert resistance prefix @", insert: "@" },
  { label: "*", ariaLabel: "Insert rest prefix *", insert: "*" },
  { label: ":", ariaLabel: "Insert timer separator :", insert: ":" },
  { label: "()", ariaLabel: "Insert rounds parentheses ()", insert: "()", cursorOffset: 1 },
  { label: "[[", ariaLabel: "Insert wiki link [[", insert: "[[", triggerComplete: true },
  { label: "|", ariaLabel: "Insert WQL pipe |", insert: " | " },
];

function mapSlotToTokenKind(slot: WheelSlot): InspectorTokenKind {
  const mt = slot.metricType?.toLowerCase();
  if (mt === "duration") return "duration";
  if (mt === "rep") return "rep";
  if (mt === "rounds") return "rounds";
  if (mt === "effort") return "effort";
  if (mt === "equipment") return "equipment";
  if (mt === "resistance") return "resistance";
  if (mt === "distance") return "distance";
  if (mt === "action") return "action";
  const raw = slot.rawText.trim();
  if (raw.startsWith("#")) return "tag";
  if (/^\*?\d+:\d{2}$/.test(raw) || raw.startsWith(":")) return "duration";
  return "custom";
}

function resolveActiveInspectorToken(
  slot: WheelSlot | undefined,
  lineNumber: number,
  tokens: readonly InspectorToken[],
): InspectorToken | null {
  if (!slot || slot.kind !== "metric") {
    return tokens[0] ?? null;
  }

  const byOverlap = tokens.find(
    (t) =>
      Math.max(t.from, slot.from) < Math.min(t.to, slot.to) ||
      (t.from === slot.from && t.to === slot.to),
  );
  if (byOverlap) return byOverlap;

  const trimmed = slot.rawText.trim() || slot.label;
  const kind = mapSlotToTokenKind(slot);
  const fallback: InspectorToken = {
    id: `slot-${slot.id}`,
    kind,
    raw: trimmed,
    displayLabel: kind === "rep" ? `${trimmed} reps` : slot.label || trimmed,
    from: slot.from,
    to: slot.to,
    lineNum: lineNumber,
    isTag: trimmed.startsWith("#"),
    isRest: kind === "duration" && trimmed.startsWith("*"),
  };
  if (kind === "duration") fallback.durationMeta = parseDurationToken(trimmed);
  if (kind === "resistance") fallback.resistanceMeta = parseResistanceToken(trimmed);
  if (kind === "distance") fallback.distanceMeta = parseDistanceToken(trimmed);
  return fallback;
}

export const MobileWheelComposer: React.FC<MobileWheelComposerProps> = ({
  view,
  noteId,
  cursorVersion,
  isOpen,
  isTypingMode,
  onSwitchToTyping,
  onDeckInteract,
  onClose,
}) => {
  const [scope, setScope] = useState<NotebookScopeSnapshot>(EMPTY_SCOPE);
  const [preferredSlotIdx, setPreferredSlotIdx] = useState<number | null>(null);
  const [useScrubber, setUseScrubber] = useState(false);
  const [deckMode, setDeckMode] = useState<InspectorMode>("token");
  const lastLineRef = useRef<number>(-1);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const deckRef = useRef<HTMLElement | null>(null);
  const [deckEl, setDeckEl] = useState<HTMLElement | null>(null);
  const attachDeckRef = useCallback((node: HTMLElement | null) => {
    deckRef.current = node;
    setDeckEl(node);
  }, []);
  const revealRafRef = useRef(0);
  const revealTimerRef = useRef<number | null>(null);
  const [viewportState, setViewportState] = useState<{
    height: number | null;
    offsetTop: number;
    keyboardOffsetBottom: number;
  }>({ height: null, offsetTop: 0, keyboardOffsetBottom: 0 });
  const [queryStageToken, setQueryStageToken] = useState(0);

  const docText = view?.state.doc.toString() ?? "";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const active = Boolean(isOpen && view);
    if (active) {
      document.documentElement.dataset.mobileEditorOpen = "true";
    } else {
      delete document.documentElement.dataset.mobileEditorOpen;
    }
    return () => {
      delete document.documentElement.dataset.mobileEditorOpen;
    };
  }, [isOpen, view]);

  useEffect(() => {
    if (!isOpen || !view) return;
    let cancelled = false;
    void loadNotebookScopeSnapshot(noteId, docText).then((loaded) => {
      if (!cancelled) setScope(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, noteId, docText, view]);

  // Track visualViewport height and bottom offset in BOTH Deck mode and Typing mode.
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      setViewportState({ height: null, offsetTop: 0, keyboardOffsetBottom: 0 });
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      setViewportState({
        height: window.innerHeight,
        offsetTop: 0,
        keyboardOffsetBottom: 0,
      });
      return;
    }
    let rafId = 0;
    const syncViewport = () => {
      rafId = 0;
      const bottomGap = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setViewportState((prev) =>
        prev.height === vv.height &&
        prev.offsetTop === vv.offsetTop &&
        prev.keyboardOffsetBottom === bottomGap
          ? prev
          : {
              height: vv.height,
              offsetTop: vv.offsetTop,
              keyboardOffsetBottom: bottomGap,
            },
      );
    };
    const scheduleSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(syncViewport);
    };
    syncViewport();
    vv.addEventListener("resize", scheduleSync);
    vv.addEventListener("scroll", scheduleSync);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      vv.removeEventListener("resize", scheduleSync);
      vv.removeEventListener("scroll", scheduleSync);
    };
  }, [isOpen]);

  // Publish exact mobile editor bottom inset so CanvasEditorPanel and full-page editors yield cleanly.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isOpen || !view || !deckEl) {
      document.documentElement.style.removeProperty("--mobile-editor-inset");
      return;
    }
    const publishInset = () => {
      const measuredHeight = Math.round(deckEl.getBoundingClientRect().height);
      const inset = measuredHeight + viewportState.keyboardOffsetBottom;
      document.documentElement.style.setProperty("--mobile-editor-inset", `${inset}px`);
    };
    publishInset();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publishInset) : null;
    ro?.observe(deckEl);
    return () => {
      ro?.disconnect();
      document.documentElement.style.removeProperty("--mobile-editor-inset");
    };
  }, [isOpen, view, deckEl, viewportState.keyboardOffsetBottom]);

  // Reset preferred slot index whenever cursor moves to a different line.
  useEffect(() => {
    if (!view) return;
    const lineNum = view.state.doc.lineAt(view.state.selection.main.head).number;
    if (lineNum !== lastLineRef.current) {
      lastLineRef.current = lineNum;
      setPreferredSlotIdx(null);
      setDeckMode("token");
      setUseScrubber(false);
    }
  }, [view, cursorVersion]);

  const model = useMemo(() => {
    if (!view || !isOpen) return null;
    void cursorVersion;
    return buildWheelComposerModel(view.state, scope, preferredSlotIdx);
  }, [view, isOpen, scope, preferredSlotIdx, cursorVersion]);

  const inspection = useMemo(() => {
    if (!view || !isOpen) return null;
    void cursorVersion;
    return extractLineTokens(view.state);
  }, [view, isOpen, cursorVersion]);

  const scheduleRevealEditRow = useCallback(
    (opts?: { pos?: number; forceCenter?: boolean; followUp?: boolean }) => {
      if (!view || !isOpen) return;
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      const runReveal = () => {
        revealMobileEditRow(view, {
          pos: opts?.pos,
          overlayEl: deckRef.current,
          forceCenter: opts?.forceCenter,
        });
      };
      revealRafRef.current = requestAnimationFrame(() => {
        revealRafRef.current = 0;
        runReveal();
      });
      if (opts?.followUp) {
        revealTimerRef.current = window.setTimeout(() => {
          revealTimerRef.current = null;
          runReveal();
        }, 120);
      }
    },
    [view, isOpen],
  );

  useEffect(() => {
    return () => {
      if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    };
  }, []);

  // Re-center edit row whenever deck/keyboard/mode transitions settle.
  useEffect(() => {
    if (!isOpen || !view) return;
    scheduleRevealEditRow({ forceCenter: true, followUp: true });
  }, [
    isOpen,
    view,
    isTypingMode,
    viewportState.keyboardOffsetBottom,
    viewportState.height,
    deckMode,
    useScrubber,
    scheduleRevealEditRow,
  ]);

  // Keep edit row visible whenever cursor or doc changes.
  useEffect(() => {
    if (!isOpen || !view) return;
    scheduleRevealEditRow();
  }, [isOpen, view, cursorVersion, scheduleRevealEditRow]);

  const activateSlot = useCallback(
    (index: number) => {
      if (!view || !model || model.slots.length === 0) return;
      const clamped = Math.max(0, Math.min(model.slots.length - 1, index));
      const slot = model.slots[clamped];
      setPreferredSlotIdx(clamped);
      setDeckMode("token");
      setUseScrubber(false);

      if (slot.kind === "metric") {
        view.dispatch({
          selection: { anchor: slot.from, head: slot.to },
        });
        scheduleRevealEditRow({ pos: slot.from });
      } else if (slot.kind === "add-metric") {
        view.dispatch({
          selection: { anchor: slot.from, head: slot.from },
        });
        scheduleRevealEditRow({ pos: slot.from });
      } else if (slot.kind === "query-stage") {
        setQueryStageToken((n) => n + 1);
      }
    },
    [view, model, scheduleRevealEditRow],
  );

  const stepSlot = useCallback(
    (delta: -1 | 1) => {
      if (!model) return;
      activateSlot(model.activeSlotIndex + delta);
    },
    [model, activateSlot],
  );

  const handleDrumSelect = useCallback(
    (drum: WheelDrumSpec, option: WheelDrumOption) => {
      if (!view || !model) return;
      const activeSlot: WheelSlot | undefined = model.slots[model.activeSlotIndex];
      if (!activeSlot) return;

      if (model.context === "workout" && activeSlot.kind === "add-metric") {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const needsSpace = line.text.length > 0 && !/\s$/.test(line.text);
        const insertText = `${needsSpace ? " " : ""}${option.value}`;
        const tokenStart = line.to + (needsSpace ? 1 : 0);
        const tokenEnd = line.to + insertText.length;

        setPreferredSlotIdx(null);
        setDeckMode("token");
        // Immediately expose the tactile load/time scrubber when inserting a load or timer token
        setUseScrubber(option.id === "add-weight" || option.id === "add-duration");
        view.dispatch({
          changes: { from: line.to, to: line.to, insert: insertText },
          selection: { anchor: tokenStart, head: tokenEnd },
          userEvent: "input.wheel",
        });
        scheduleRevealEditRow({ pos: tokenStart });
        return;
      }

      if (model.context === "workout") {
        let replacement = option.value;
        if (drum.id === "duration-min" || drum.id === "duration-sec") {
          replacement = option.value;
        }
        const newTo = activeSlot.from + replacement.length;
        view.dispatch({
          changes: { from: activeSlot.from, to: activeSlot.to, insert: replacement },
          selection: { anchor: activeSlot.from, head: newTo },
          userEvent: "input.wheel",
        });
        scheduleRevealEditRow({ pos: activeSlot.from });
      }
    },
    [view, model, scheduleRevealEditRow],
  );

  const handleInsertNewLine = useCallback(() => {
    if (!view) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const indentMatch = line.text.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    const insert = `\n${indent}`;
    const nextPos = line.to + insert.length;
    setPreferredSlotIdx(null);
    setDeckMode("token");
    view.dispatch({
      changes: { from: line.to, to: line.to, insert },
      selection: { anchor: nextPos },
      userEvent: "input.wheel",
    });
    scheduleRevealEditRow({ pos: nextPos });
  }, [view, scheduleRevealEditRow]);

  const handleEnterTypingMode = useCallback(() => {
    if (!view) return;
    view.contentDOM.setAttribute("inputmode", "text");
    onSwitchToTyping(true);
    view.focus();
  }, [view, onSwitchToTyping]);

  const handleReturnToWheel = useCallback(() => {
    if (!view) return;
    view.contentDOM.setAttribute("inputmode", "none");
    onSwitchToTyping(false);
    view.focus();
  }, [view, onSwitchToTyping]);

  const handleDone = useCallback(() => {
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.mobileEditorOpen;
      document.documentElement.style.removeProperty("--mobile-editor-inset");
    }
    view?.contentDOM.blur();
    onClose();
  }, [view, onClose]);

  const handleInsertSyntaxKey = useCallback(
    (keySpec: (typeof SYNTAX_KEYS)[number]) => {
      if (!view) return;
      const sel = view.state.selection.main;
      const nextCursor = sel.from + (keySpec.cursorOffset ?? keySpec.insert.length);
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: keySpec.insert },
        selection: { anchor: nextCursor },
        userEvent: "input",
      });
      view.focus();
      scheduleRevealEditRow({ pos: nextCursor });
      if (keySpec.triggerComplete) {
        queueMicrotask(() => {
          startCompletion(view);
        });
      }
    },
    [view, scheduleRevealEditRow],
  );

  const onRailPointerStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[role="listbox"], input, textarea, select')) {
      swipeStartRef.current = null;
      return;
    }
    if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth + 4) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onRailPointerFinish = useCallback(
    (clientX: number, clientY: number) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (Math.abs(dx) >= 28 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        stepSlot(dx < 0 ? 1 : -1);
      }
    },
    [stepSlot],
  );

  if (!isOpen || !view || !model || !inspection) return null;

  const activeSlot = model.slots[model.activeSlotIndex];
  const activeToken = resolveActiveInspectorToken(
    activeSlot,
    model.lineNumber,
    inspection.tokens,
  );

  // Sync deck inspector mode smoothly when entering markdown/query contexts
  const effectiveMode: InspectorMode =
    deckMode === "block" ||
    deckMode === "add" ||
    deckMode === "wiki" ||
    deckMode === "prose-tag"
      ? deckMode
      : model.context === "query"
        ? "query"
        : model.context === "markdown"
          ? "markdown"
          : "token";

  const canDeleteToken =
    model.context === "workout" &&
    activeSlot?.kind === "metric" &&
    activeToken !== null &&
    effectiveMode === "token";

  const { height: vvHeight, keyboardOffsetBottom } = viewportState;

  if (isTypingMode) {
    return (
      <div
        ref={attachDeckRef}
        data-testid="mobile-typing-bar"
        data-mobile-editor-deck="true"
        onPointerDownCapture={() => onDeckInteract?.()}
        style={{
          bottom: `${keyboardOffsetBottom}px`,
          ...(keyboardOffsetBottom > 0 ? { paddingBottom: 0 } : {}),
        }}
        className="fixed inset-x-0 z-40 flex flex-col border-t border-border bg-card text-card-foreground shadow-lg select-none overscroll-contain pb-[env(safe-area-inset-bottom,0px)]"
      >
        {/* Persistent Live Token Rail above OS keyboard */}
        <div className="flex min-h-[48px] items-center gap-1.5 overflow-x-auto overscroll-x-contain border-b border-border bg-muted/40 px-2.5 scrollbar-none">
          <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
            L{model.lineNumber}
          </span>
          {model.slots.map((slot, idx) => {
            const isActive = idx === model.activeSlotIndex;
            return (
              <button
                key={slot.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  activateSlot(idx);
                  handleReturnToWheel();
                }}
                className={cn(
                  "shrink-0 min-h-[44px] rounded-full border px-3 text-xs font-mono tabular-nums transition-colors cursor-pointer",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground font-semibold"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {slot.label}
              </button>
            );
          })}
        </div>

        {/* Syntax Accessory Keys + Deck / Done Bar */}
        <div className="flex min-h-[48px] items-center justify-between gap-1.5 px-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain scrollbar-none">
            <button
              type="button"
              data-testid="mobile-return-wheel-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleReturnToWheel}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <SlidersHorizontalIcon weight="bold" className="h-3.5 w-3.5" />
              <span>Deck</span>
            </button>

            {SYNTAX_KEYS.map((keySpec) => (
              <button
                key={keySpec.label}
                type="button"
                aria-label={keySpec.ariaLabel}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleInsertSyntaxKey(keySpec)}
                className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 font-mono text-xs font-semibold text-foreground hover:bg-muted cursor-pointer transition-colors"
              >
                {keySpec.label}
              </button>
            ))}

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => indentLess(view)}
              aria-label="Outdent line"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <TextOutdentIcon weight="bold" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => indentMore(view)}
              aria-label="Indent line"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <TextIndentIcon weight="bold" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleInsertNewLine}
              className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <PlusIcon weight="bold" className="h-3.5 w-3.5" />
              <span>Line</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="mobile-wheel-done-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDone}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground cursor-pointer"
          >
            <CheckIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    );
  }

  const deckDynamicStyle: React.CSSProperties = {
    bottom: `${keyboardOffsetBottom}px`,
    ...(vvHeight !== null && keyboardOffsetBottom > 0
      ? {
          paddingBottom: 0,
          height: `${Math.min(276, Math.max(184, Math.round(vvHeight * 0.52)))}px`,
          minHeight: "184px",
        }
      : vvHeight !== null
        ? {
            maxHeight: `${Math.min(360, Math.max(252, Math.round(vvHeight * 0.44)))}px`,
          }
        : {}),
  };

  return (
    <section
      ref={attachDeckRef}
      aria-label="Mobile workout and note thumb deck"
      data-testid="mobile-wheel-composer"
      data-mobile-editor-deck="true"
      onPointerDownCapture={() => onDeckInteract?.()}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          e.preventDefault();
        }
      }}
      style={deckDynamicStyle}
      className="fixed inset-x-0 bottom-0 z-40 h-[min(42svh,360px)] max-h-[380px] min-h-[252px] flex flex-col border-t border-border bg-card text-card-foreground shadow-xl select-none overscroll-contain pb-[env(safe-area-inset-bottom,0px)]"
    >
      {/* Region 1: Live Token Rail */}
      <div
        data-testid="mobile-wheel-slot-rail"
        onPointerDown={onRailPointerStart}
        onPointerUp={(e) => onRailPointerFinish(e.clientX, e.clientY)}
        className="flex min-h-[48px] items-center gap-1.5 overflow-x-auto overscroll-x-contain border-b border-border bg-muted/40 px-2 scrollbar-none"
      >
        <div className="flex shrink-0 items-center gap-1 pr-1">
          <button
            type="button"
            data-testid="mobile-wheel-prev-slot"
            aria-label="Previous slot"
            disabled={model.activeSlotIndex <= 0}
            onClick={() => stepSlot(-1)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background text-foreground disabled:opacity-35 hover:bg-muted cursor-pointer transition-colors"
          >
            <CaretLeftIcon weight="bold" className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="mobile-wheel-next-slot"
            aria-label="Next slot"
            disabled={model.activeSlotIndex >= model.slots.length - 1}
            onClick={() => stepSlot(1)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background text-foreground disabled:opacity-35 hover:bg-muted cursor-pointer transition-colors"
          >
            <CaretRightIcon weight="bold" className="h-4 w-4" />
          </button>
          <span className="pl-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
            L{model.lineNumber}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {model.slots.map((slot, idx) => {
            const isActive = idx === model.activeSlotIndex && deckMode !== "block";
            const isAdd = slot.kind === "add-metric";
            return (
              <button
                key={slot.id}
                type="button"
                data-testid={`mobile-wheel-slot-${slot.kind === "add-metric" ? "add" : idx}`}
                onClick={() => activateSlot(idx)}
                className={cn(
                  "shrink-0 min-h-[44px] rounded-full border px-3 text-xs font-mono tabular-nums transition-colors cursor-pointer",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground font-semibold"
                    : isAdd
                      ? "border-dashed border-border bg-background text-foreground hover:bg-muted"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {slot.label}
              </button>
            );
          })}

          {inspection.lintFixes.map((fix) =>
            fix.fixes.slice(0, 1).map((rep) => (
              <button
                key={`${fix.id}:${rep}`}
                type="button"
                data-testid={TEST_IDS.EDITOR_LINT_QUICK_FIX}
                onClick={() => applyQuickFixInView(view, fix, rep)}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-dashed border-destructive/40 bg-destructive/10 px-2.5 text-xs font-mono font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground cursor-pointer transition-colors"
              >
                <WarningCircleIcon weight="bold" className="h-3.5 w-3.5 shrink-0" />
                <span>Fix: {rep}</span>
              </button>
            )),
          )}

          {model.context === "workout" && (
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_BLOCK_SETTINGS_BTN}
              aria-pressed={effectiveMode === "block"}
              onClick={() => setDeckMode((prev) => (prev === "block" ? "token" : "block"))}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium cursor-pointer transition-colors",
                effectiveMode === "block"
                  ? "border-primary bg-primary/15 text-primary font-semibold"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontalIcon weight="bold" className="h-3.5 w-3.5 shrink-0" />
              <span>Block</span>
            </button>
          )}
        </div>
      </div>

      {/* Region 2: Unified Contextual Action Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5">
        {model.context === "workout" &&
        activeSlot?.kind === "add-metric" &&
        effectiveMode !== "block" &&
        effectiveMode !== "add" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Append metric to line {model.lineNumber}
              </span>
              <button
                type="button"
                onClick={() => setDeckMode("add")}
                className="inline-flex min-h-[44px] items-center rounded-md px-2.5 text-xs font-medium text-primary hover:bg-primary/10 cursor-pointer"
              >
                Full Catalog
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {(model.drums[0]?.options ?? []).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`wheel-option-${opt.id}`}
                  onClick={() => {
                    if (model.drums[0]) handleDrumSelect(model.drums[0], opt);
                  }}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-left text-popover-foreground hover:bg-muted cursor-pointer transition-colors"
                >
                  <span className="truncate text-xs font-semibold">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {opt.sublabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <TokenInspectorPanel
            view={view}
            mode={effectiveMode}
            inspection={inspection}
            token={activeToken}
            scope={scope}
            docText={docText}
            useScrubber={useScrubber}
            onToggleScrubber={() => setUseScrubber((prev) => !prev)}
            compact
            showHeader={false}
            showFooter={false}
            showStepButtons={false}
            showClose={false}
            showDockButton={false}
            activeQueryStageId={activeSlot?.kind === "query-stage" ? activeSlot.id : undefined}
            queryStageRequestToken={queryStageToken}
            onModeChange={(nextMode) => setDeckMode(nextMode)}
            onMutate={() => {
              // Line state refreshes via CM6 updateListener -> cursorVersion
              scheduleRevealEditRow();
            }}
          />
        )}
      </div>

      {/* Region 3: Pinned 44px Thumb Footer */}
      <div className="flex min-h-[52px] items-center justify-between gap-1.5 border-t border-border bg-muted/40 px-2.5 py-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              undo(view);
              view.focus();
            }}
            aria-label="Undo last edit"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
          >
            <ArrowCounterClockwiseIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Undo</span>
          </button>

          <button
            type="button"
            data-testid={TEST_IDS.EDITOR_TOKEN_DELETE_BTN}
            disabled={!canDeleteToken}
            onClick={() => {
              if (activeToken) {
                deleteTokenInView(view, activeToken);
                setPreferredSlotIdx(null);
              }
            }}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-destructive disabled:opacity-35 hover:bg-destructive/10 cursor-pointer transition-colors"
          >
            <TrashIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Delete</span>
          </button>

          <button
            type="button"
            data-testid="mobile-wheel-newline-btn"
            onClick={handleInsertNewLine}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
          >
            <PlusIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Line</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="mobile-wheel-type-btn"
            onClick={handleEnterTypingMode}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
          >
            <KeyboardIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Type</span>
          </button>

          <button
            type="button"
            data-testid="mobile-wheel-done-btn"
            onClick={handleDone}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground cursor-pointer transition-colors"
          >
            <CheckIcon weight="bold" className="h-3.5 w-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </section>
  );
};
