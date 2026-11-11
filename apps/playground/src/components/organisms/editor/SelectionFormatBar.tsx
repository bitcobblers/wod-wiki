/**
 * SelectionFormatBar — Desktop-only (>=1024px) floating formatting bar shown
 * above non-empty selections inside Markdown prose sections.
 *
 * Strictly adheres to Premium Utilitarian Minimalism:
 *  - Flat bg-card surface, 1px hairline border, ultra-diffuse 2px shadow
 *  - Phosphor Bold icons, zero emojis, zero glassmorphism
 */

import React, { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  activeCursorSection,
  insertMarkdownLinkCommand,
  toggleInlineMarkdown,
} from "@bitcobblers/wod-wiki-ui/extensions";
import {
  Code,
  LinkSimple,
  TextB,
  TextItalic,
  TextStrikethrough,
  Timer,
} from "@phosphor-icons/react";

export interface SelectionFormatBarProps {
  view: EditorView | null;
  cursorVersion: number;
  disabled?: boolean;
}

interface BarPosition {
  top: number;
  left: number;
}

export const SelectionFormatBar: React.FC<SelectionFormatBarProps> = ({
  view,
  cursorVersion,
  disabled = false,
}) => {
  const [pos, setPos] = useState<BarPosition | null>(null);

  useEffect(() => {
    if (!view || disabled || view.state.readOnly) {
      setPos(null);
      return;
    }

    const sel = view.state.selection.main;
    if (sel.empty || !view.hasFocus) {
      setPos(null);
      return;
    }

    const section = activeCursorSection(view.state);
    if (!section || section.type !== "markdown") {
      setPos(null);
      return;
    }

    const startCoords = view.coordsAtPos(sel.from);
    const endCoords = view.coordsAtPos(sel.to);
    const editorRect = view.dom.getBoundingClientRect();
    if (!startCoords || !endCoords) {
      setPos(null);
      return;
    }

    const centerLeft = (startCoords.left + endCoords.right) / 2 - editorRect.left;
    const clampedLeft = Math.max(96, Math.min(editorRect.width - 96, centerLeft));
    const rawTop = startCoords.top - editorRect.top - 38;
    const top = rawTop < 4 ? endCoords.bottom - editorRect.top + 6 : rawTop;

    setPos({ top, left: clampedLeft });
  }, [view, cursorVersion, disabled]);

  if (!pos || !view) return null;

  const wrapSelectionAsTimeFence = () => {
    const sel = view.state.selection.main;
    if (sel.empty) return;
    const selectedText = view.state.doc.sliceString(sel.from, sel.to);
    const block = `\n\`\`\`time\n${selectedText}\n\`\`\`\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: block },
      selection: { anchor: sel.from + 9, head: sel.from + 9 + selectedText.length },
      userEvent: "input.format",
    });
    view.focus();
  };

  const actions: Array<{
    id: string;
    label: string;
    Icon: React.ComponentType<{ className?: string; weight?: "bold" }>;
    run: () => void;
  }> = [
    {
      id: "bold",
      label: "Bold (Ctrl+B)",
      Icon: TextB,
      run: () => {
        toggleInlineMarkdown(view, "**");
        view.focus();
      },
    },
    {
      id: "italic",
      label: "Italic (Ctrl+I)",
      Icon: TextItalic,
      run: () => {
        toggleInlineMarkdown(view, "*");
        view.focus();
      },
    },
    {
      id: "strike",
      label: "Strikethrough",
      Icon: TextStrikethrough,
      run: () => {
        toggleInlineMarkdown(view, "~~");
        view.focus();
      },
    },
    {
      id: "code",
      label: "Inline code (Ctrl+E)",
      Icon: Code,
      run: () => {
        toggleInlineMarkdown(view, "`");
        view.focus();
      },
    },
    {
      id: "link",
      label: "Insert link (Ctrl+K)",
      Icon: LinkSimple,
      run: () => {
        insertMarkdownLinkCommand(view);
        view.focus();
      },
    },
    {
      id: "timer",
      label: "Wrap in timer block",
      Icon: Timer,
      run: wrapSelectionAsTimeFence,
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      data-testid="selection-format-bar"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        transform: "translateX(-50%)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}
      className="z-30 hidden lg:inline-flex items-center gap-0.5 px-1 py-0.5 rounded-[6px] bg-card border border-border text-foreground"
    >
      {actions.map(({ id, label, Icon, run }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          data-testid={`format-bar-${id}`}
          onClick={run}
          className="inline-flex items-center justify-center h-6 w-6 rounded-[4px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Icon weight="bold" className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
};
