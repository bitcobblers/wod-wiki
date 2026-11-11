/**
 * MobileWheelComposer — Half-screen tactile flick & scroll-wheel composer
 * for mobile (<1024px) note and workout authoring.
 *
 * Strictly adheres to the Premium Utilitarian Minimalism protocol:
 *  - Warm monochrome surfaces (#F7F6F3 / bg-card) with crisp 1px hairlines
 *  - Zero heavy shadows, zero gradients, zero emojis
 *  - Phosphor Bold iconography + JetBrains Mono tabular numerals on wheels
 *  - Keeps >55dvh of live CodeMirror document visible above the deck
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { indentMore, indentLess } from "@codemirror/commands";
import {
  CaretLeft,
  CaretRight,
  Check,
  Keyboard,
  Plus,
  SlidersHorizontal,
  TextIndent,
  TextOutdent,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  buildWheelComposerModel,
  loadNotebookScopeSnapshot,
  type NotebookScopeSnapshot,
  type WheelDrumOption,
  type WheelDrumSpec,
  type WheelSlot,
} from "./wheelSources";

export interface MobileWheelComposerProps {
  view: EditorView | null;
  noteId?: string;
  cursorVersion: number;
  isOpen: boolean;
  isTypingMode: boolean;
  onSwitchToTyping: (typing: boolean) => void;
  onClose: () => void;
}

const EMPTY_SCOPE: NotebookScopeSnapshot = {
  tags: [],
  defaultEquipment: [],
  customMetricTypes: [],
};

const ROW_HEIGHT_PX = 36;

interface ScrollDrumProps {
  drum: WheelDrumSpec;
  autoCommitOnScroll: boolean;
  onSelect: (option: WheelDrumOption) => void;
}

const ScrollDrum: React.FC<ScrollDrumProps> = ({
  drum,
  autoCommitOnScroll,
  onSelect,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);

  const selectedIndex = useMemo(() => {
    const idx = drum.options.findIndex((o) => o.value === drum.selectedValue);
    return idx >= 0 ? idx : 0;
  }, [drum.options, drum.selectedValue]);

  // Center the active item when drum identity or selectedValue changes externally.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const targetTop = selectedIndex * ROW_HEIGHT_PX;
    if (Math.abs(el.scrollTop - targetTop) > 4) {
      programmaticScrollRef.current = true;
      el.scrollTop = targetTop;
      window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 80);
    }
  }, [drum.id, selectedIndex]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (!autoCommitOnScroll || programmaticScrollRef.current) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = Math.max(
        0,
        Math.min(drum.options.length - 1, Math.round(el.scrollTop / ROW_HEIGHT_PX)),
      );
      const option = drum.options[idx];
      if (option && option.value !== drum.selectedValue) {
        onSelect(option);
      }
    }, 130);
  }, [autoCommitOnScroll, drum.options, drum.selectedValue, onSelect]);

  return (
    <div
      className="relative flex-1 min-w-0 h-full flex flex-col overflow-hidden"
      data-testid={`wheel-drum-${drum.id}`}
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground border-b border-border/70 truncate">
        {drum.label}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* Center mechanical selection hairlines */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 h-9 border-y border-border bg-background/55 rounded-[4px]"
        />

        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="relative z-10 h-full overflow-y-auto snap-y snap-mandatory overscroll-contain scrollbar-none"
          style={{
            paddingTop: "calc(50% - 18px)",
            paddingBottom: "calc(50% - 18px)",
          }}
        >
          {drum.options.map((option, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={option.id}
                type="button"
                data-testid={`wheel-option-${option.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = scrollerRef.current;
                  if (el) {
                    programmaticScrollRef.current = true;
                    if (typeof el.scrollTo === "function") {
                      el.scrollTo({ top: idx * ROW_HEIGHT_PX, behavior: "smooth" });
                    } else {
                      el.scrollTop = idx * ROW_HEIGHT_PX;
                    }
                    window.setTimeout(() => {
                      programmaticScrollRef.current = false;
                    }, 160);
                  }
                  onSelect(option);
                }}
                className={cn(
                  "w-full h-9 snap-center px-3 flex items-center justify-between gap-2 text-left transition-colors",
                  isSelected
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate text-[13px] font-mono tabular-nums">
                  {option.label}
                </span>
                {option.sublabel && (
                  <span className="shrink-0 text-[11px] font-mono tabular-nums text-muted-foreground">
                    {option.sublabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const MobileWheelComposer: React.FC<MobileWheelComposerProps> = ({
  view,
  noteId,
  cursorVersion,
  isOpen,
  isTypingMode,
  onSwitchToTyping,
  onClose,
}) => {
  const [scope, setScope] = useState<NotebookScopeSnapshot>(EMPTY_SCOPE);
  const [preferredSlotIdx, setPreferredSlotIdx] = useState<number | null>(null);
  const lastLineRef = useRef<number>(-1);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [keyboardOffsetBottom, setKeyboardOffsetBottom] = useState(0);

  const docText = view?.state.doc.toString() ?? "";

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

  // Track visualViewport offset when native keyboard is up in typing mode.
  useEffect(() => {
    if (!isOpen || !isTypingMode || typeof window === "undefined") {
      setKeyboardOffsetBottom(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const syncViewport = () => {
      const bottomGap = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboardOffsetBottom(bottomGap);
    };
    syncViewport();
    vv.addEventListener("resize", syncViewport);
    vv.addEventListener("scroll", syncViewport);
    return () => {
      vv.removeEventListener("resize", syncViewport);
      vv.removeEventListener("scroll", syncViewport);
    };
  }, [isOpen, isTypingMode]);

  // Reset preferred slot index whenever the cursor moves to a different line.
  useEffect(() => {
    if (!view) return;
    const lineNum = view.state.doc.lineAt(view.state.selection.main.head).number;
    if (lineNum !== lastLineRef.current) {
      lastLineRef.current = lineNum;
      setPreferredSlotIdx(null);
    }
  }, [view, cursorVersion]);

  const model = useMemo(() => {
    if (!view || !isOpen) return null;
    // Reference cursorVersion so React recomputes on selection/doc transactions.
    void cursorVersion;
    return buildWheelComposerModel(view.state, scope, preferredSlotIdx);
  }, [view, isOpen, scope, preferredSlotIdx, cursorVersion]);

  const revealLineAboveDeck = useCallback((targetView: EditorView, pos: number) => {
    targetView.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "center", yMargin: 32 }),
    });
  }, []);

  const activateSlot = useCallback(
    (index: number) => {
      if (!view || !model || model.slots.length === 0) return;
      const clamped = Math.max(0, Math.min(model.slots.length - 1, index));
      const slot = model.slots[clamped];
      setPreferredSlotIdx(clamped);

      if (slot.kind === "metric") {
        view.dispatch({
          selection: { anchor: slot.from, head: slot.to },
        });
        revealLineAboveDeck(view, slot.from);
      } else if (slot.kind === "add-metric") {
        view.dispatch({
          selection: { anchor: slot.from, head: slot.from },
        });
        revealLineAboveDeck(view, slot.from);
      }
    },
    [view, model, revealLineAboveDeck],
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

      if (model.context === "workout") {
        if (activeSlot.kind === "add-metric") {
          const line = view.state.doc.lineAt(view.state.selection.main.head);
          const needsSpace = line.text.length > 0 && !/\s$/.test(line.text);
          const insertText = `${needsSpace ? " " : ""}${option.value}`;
          const tokenStart = line.to + (needsSpace ? 1 : 0);
          const tokenEnd = line.to + insertText.length;

          // Clear slot override so the model focuses the newly inserted metric token!
          setPreferredSlotIdx(null);
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: { anchor: tokenStart, head: tokenEnd },
            userEvent: "input.wheel",
          });
          revealLineAboveDeck(view, tokenStart);
          return;
        }

        // Editing an existing metric slot on the line
        let replacement = option.value;
        if (drum.id === "duration-min" || drum.id === "duration-sec") {
          const minDrum = model.drums.find((d) => d.id === "duration-min");
          const secDrum = model.drums.find((d) => d.id === "duration-sec");
          const mins = drum.id === "duration-min" ? option.value : (minDrum?.selectedValue ?? "1");
          const secs = drum.id === "duration-sec" ? option.value : (secDrum?.selectedValue ?? "00");
          replacement = `${mins}:${secs}`;
        } else if (drum.id === "unit-amount" || drum.id === "unit-suffix") {
          const amtDrum = model.drums.find((d) => d.id === "unit-amount");
          const unitDrum = model.drums.find((d) => d.id === "unit-suffix");
          const amt = drum.id === "unit-amount" ? option.value : (amtDrum?.selectedValue ?? "20");
          const unit = drum.id === "unit-suffix" ? option.value : (unitDrum?.selectedValue ?? "kg");
          replacement = `${amt}${unit}`;
        }

        const newTo = activeSlot.from + replacement.length;
        view.dispatch({
          changes: { from: activeSlot.from, to: activeSlot.to, insert: replacement },
          selection: { anchor: activeSlot.from, head: newTo },
          userEvent: "input.wheel",
        });
        revealLineAboveDeck(view, activeSlot.from);
        return;
      }

      if (model.context === "markdown") {
        const line = view.state.doc.line(model.lineNumber);
        const sel = view.state.selection.main;
        const val = option.value;

        if (val.startsWith("block:")) {
          const kind = val.slice("block:".length);
          const prefix = line.text.trim().length > 0 ? "\n" : "";
          if (kind === "time" || kind === "log") {
            const snippet = `${prefix}\`\`\`${kind}\n\n\`\`\``;
            const innerPos = line.to + prefix.length + 4 + kind.length;
            setPreferredSlotIdx(null);
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: snippet },
              selection: { anchor: innerPos },
              userEvent: "input.wheel",
            });
            revealLineAboveDeck(view, innerPos);
          } else if (kind === "query") {
            const body = "sum:reps{} every week | :bar{}";
            const snippet = `${prefix}\`\`\`query\n${body}\n\`\`\``;
            const innerPos = line.to + prefix.length + "```query\n".length;
            setPreferredSlotIdx(null);
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: snippet },
              selection: { anchor: innerPos, head: innerPos + body.length },
              userEvent: "input.wheel",
            });
            revealLineAboveDeck(view, innerPos);
          } else if (kind === "table") {
            const tbl = `${prefix}| Movement | Load | Notes |\n| --- | --- | --- |\n| Squat | 100kg | Smooth |\n`;
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: tbl },
              selection: { anchor: line.to + tbl.length },
              userEvent: "input.wheel",
            });
          } else if (kind === "divider") {
            const hr = `${prefix}---\n`;
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: hr },
              selection: { anchor: line.to + hr.length },
              userEvent: "input.wheel",
            });
          }
          return;
        }

        if (val.startsWith("prefix:")) {
          const prefixToken = val.slice("prefix:".length);
          const stripped = line.text.replace(/^(#{1,6}\s+|>\s+|-\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, "");
          const nextLine = `${prefixToken}${stripped}`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: nextLine },
            selection: { anchor: line.from + nextLine.length },
            userEvent: "input.wheel",
          });
          revealLineAboveDeck(view, line.from);
          return;
        }

        if (val.startsWith("wrap:")) {
          const marker = val.slice("wrap:".length);
          const selected = sel.empty ? "text" : view.state.doc.sliceString(sel.from, sel.to);
          const wrapped = `${marker}${selected}${marker}`;
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: wrapped },
            selection: {
              anchor: sel.from + marker.length,
              head: sel.from + marker.length + selected.length,
            },
            userEvent: "input.wheel",
          });
          return;
        }

        if (val.startsWith("insert:")) {
          const text = val.slice("insert:".length);
          view.dispatch({
            changes: { from: sel.to, to: sel.to, insert: text },
            selection: { anchor: sel.to + text.length },
            userEvent: "input.wheel",
          });
          return;
        }
      }

      if (model.context === "query") {
        const line = view.state.doc.line(model.lineNumber);
        const val = option.value;
        if (val.startsWith("replace:")) {
          const body = val.slice("replace:".length);
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: body },
            selection: { anchor: line.from + body.length },
            userEvent: "input.wheel",
          });
        } else if (val.startsWith("append:")) {
          const suffix = val.slice("append:".length);
          if (!line.text.includes(suffix.trim())) {
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: suffix },
              selection: { anchor: line.to + suffix.length },
              userEvent: "input.wheel",
            });
          }
        }
      }
    },
    [view, model, revealLineAboveDeck],
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
    view.dispatch({
      changes: { from: line.to, to: line.to, insert },
      selection: { anchor: nextPos },
      userEvent: "input.wheel",
    });
    revealLineAboveDeck(view, nextPos);
  }, [view, revealLineAboveDeck]);

  const handleEnterTypingMode = useCallback(() => {
    if (!view) return;
    // Synchronously unlock inputmode inside the user click gesture so iOS/Android
    // immediately open the native software keyboard.
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
    view?.contentDOM.blur();
    onClose();
  }, [view, onClose]);

  const onPointerStart = useCallback((clientX: number, clientY: number) => {
    swipeStartRef.current = { x: clientX, y: clientY };
  }, []);

  const onPointerFinish = useCallback(
    (clientX: number, clientY: number) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (Math.abs(dx) >= 28 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        // Flick left advances to the next slot; flick right steps back.
        stepSlot(dx < 0 ? 1 : -1);
      }
    },
    [stepSlot],
  );

  if (!isOpen || !view || !model) return null;

  if (isTypingMode) {
    return (
      <div
        data-testid="mobile-typing-bar"
        style={{ bottom: `${keyboardOffsetBottom}px` }}
        className="fixed inset-x-0 z-40 h-10 flex items-center justify-between gap-1.5 px-2.5 bg-[#F7F6F3] dark:bg-card border-t border-border select-none"
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="mobile-return-wheel-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleReturnToWheel}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors"
          >
            <SlidersHorizontal weight="bold" className="h-3.5 w-3.5" />
            <span>Wheel</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => indentMore(view)}
            aria-label="Indent line"
            className="inline-flex items-center justify-center h-7 w-7 rounded-[4px] border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            <TextIndent weight="bold" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleInsertNewLine}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[4px] border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors"
          >
            <Plus weight="bold" className="h-3 w-3" />
            <span>Line</span>
          </button>
        </div>

        <button
          type="button"
          data-testid="mobile-wheel-done-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleDone}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[4px] bg-foreground text-background text-xs font-medium"
        >
          <Check weight="bold" className="h-3.5 w-3.5" />
          <span>Done</span>
        </button>
      </div>
    );
  }

  const activeSlot = model.slots[model.activeSlotIndex];
  const autoCommitOnScroll =
    model.context === "workout" && activeSlot?.kind === "metric";

  return (
    <section
      aria-label="Mobile workout and note wheel composer"
      data-testid="mobile-wheel-composer"
      onMouseDown={(e) => {
        // Prevent clicking chrome from blurring CodeMirror's active selection
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          e.preventDefault();
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) onPointerStart(t.clientX, t.clientY);
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        if (t) onPointerFinish(t.clientX, t.clientY);
      }}
      className="fixed inset-x-0 bottom-0 z-40 h-[40dvh] max-h-[300px] min-h-[216px] flex flex-col bg-[#F7F6F3] dark:bg-card border-t border-border select-none"
    >
      {/* Top Action Bar */}
      <div className="h-10 px-2.5 flex items-center justify-between gap-1.5 border-b border-border bg-background/70">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="mobile-wheel-prev-slot"
            aria-label="Previous slot"
            disabled={model.activeSlotIndex <= 0}
            onClick={() => stepSlot(-1)}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[4px] border border-border bg-background text-foreground disabled:opacity-35 hover:bg-muted transition-colors"
          >
            <CaretLeft weight="bold" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="mobile-wheel-next-slot"
            aria-label="Next slot"
            disabled={model.activeSlotIndex >= model.slots.length - 1}
            onClick={() => stepSlot(1)}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[4px] border border-border bg-background text-foreground disabled:opacity-35 hover:bg-muted transition-colors"
          >
            <CaretRight weight="bold" className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            data-testid="mobile-wheel-newline-btn"
            onClick={handleInsertNewLine}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[4px] border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors"
          >
            <Plus weight="bold" className="h-3 w-3" />
            <span>Line</span>
          </button>

          <button
            type="button"
            aria-label="Outdent line"
            onClick={() => indentLess(view)}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[4px] border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            <TextOutdent weight="bold" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Indent line"
            onClick={() => indentMore(view)}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[4px] border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            <TextIndent weight="bold" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="mobile-wheel-type-btn"
            onClick={handleEnterTypingMode}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[4px] border border-border bg-background text-foreground text-xs font-medium hover:bg-muted transition-colors"
          >
            <Keyboard weight="bold" className="h-3.5 w-3.5" />
            <span>Type</span>
          </button>
          <button
            type="button"
            data-testid="mobile-wheel-done-btn"
            onClick={handleDone}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[4px] bg-foreground text-background text-xs font-medium"
          >
            <Check weight="bold" className="h-3.5 w-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>

      {/* Horizontal Flickable Token / Stage Rail */}
      <div
        data-testid="mobile-wheel-slot-rail"
        onPointerDown={(e) => onPointerStart(e.clientX, e.clientY)}
        onPointerUp={(e) => onPointerFinish(e.clientX, e.clientY)}
        className="h-9 px-2.5 flex items-center gap-1.5 overflow-x-auto border-b border-border scrollbar-none"
      >
        <span className="shrink-0 text-[10px] font-mono tabular-nums uppercase tracking-[0.05em] text-muted-foreground pr-1">
          L{model.lineNumber}
        </span>
        {model.slots.map((slot, idx) => {
          const isActive = idx === model.activeSlotIndex;
          const isAdd = slot.kind === "add-metric";
          return (
            <button
              key={slot.id}
              type="button"
              data-testid={`mobile-wheel-slot-${slot.kind === "add-metric" ? "add" : idx}`}
              onClick={() => activateSlot(idx)}
              className={cn(
                "shrink-0 h-6 px-2.5 rounded-[4px] text-xs font-mono tabular-nums border transition-colors",
                isActive
                  ? "bg-foreground text-background border-foreground font-semibold"
                  : isAdd
                    ? "bg-background text-foreground border-dashed border-border hover:bg-muted"
                    : "bg-background text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {slot.label}
            </button>
          );
        })}
      </div>

      {/* Vertical Scroll-Snap Drums */}
      <div className="flex-1 min-h-0 flex divide-x divide-border">
        {model.drums.map((drum) => (
          <ScrollDrum
            key={drum.id}
            drum={drum}
            autoCommitOnScroll={autoCommitOnScroll}
            onSelect={(opt) => handleDrumSelect(drum, opt)}
          />
        ))}
      </div>
    </section>
  );
};
