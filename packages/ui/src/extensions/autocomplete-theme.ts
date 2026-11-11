import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Token-based autocomplete tooltip theme shared by every editor surface
 * (editorPreset all dialects, WqlTextEditor, CalcLineEditor). Semantic
 * popover/border/muted/primary tokens resolve identically in light and dark,
 * so one theme serves both without branching.
 */
export const autocompleteTooltipTheme: Extension = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
    fontFamily: 'var(--font-sans, "Geist Sans", "SF Pro Display", Switzer, "Helvetica Neue", system-ui, sans-serif)',
    fontSize: "13px",
    zIndex: "40",
  },
  ".cm-tooltip-autocomplete": {
    overflow: "hidden",
    minWidth: "min(18rem, calc(100vw - 2rem))",
    maxWidth: "calc(100vw - 2rem)",
  },
  ".cm-tooltip-autocomplete > ul": {
    padding: "4px",
    maxHeight: "min(45svh, 20rem)",
    overscrollBehavior: "contain",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "36px",
    padding: "6px 10px",
    borderRadius: "4px",
    lineHeight: "20px",
  },
  ".cm-tooltip-autocomplete > ul > li:hover": {
    backgroundColor: "hsl(var(--muted) / 0.55)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected=\"true\"]": {
    backgroundColor: "hsl(var(--muted))",
    color: "hsl(var(--foreground))",
    fontWeight: "600",
  },
  ".cm-completionLabel": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "700",
    color: "hsl(var(--foreground))",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "12px",
    fontFamily: 'var(--font-sans, "Geist Sans", "SF Pro Display", Switzer, "Helvetica Neue", system-ui, sans-serif)',
    fontSize: "11px",
    fontStyle: "normal",
    color: "hsl(var(--muted-foreground))",
  },
  "@media (pointer: coarse)": {
    ".cm-tooltip-autocomplete > ul > li": { minHeight: "48px" },
  },
});
