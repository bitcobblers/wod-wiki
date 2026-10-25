import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Token-based autocomplete tooltip theme shared by every editor surface
 * (editorPreset all dialects, WqlTextEditor, CalcLineEditor). Semantic
 * popover/border/muted/primary tokens resolve identically in light and dark,
 * so one theme serves both without branching.
 *
 * Stacking: tooltips deliberately sit below dialog overlays (z-50) so a host
 * dialog's chrome wins, while staying above sticky headers and page content —
 * the tooltip still renders inside dialog/sticky hosts because it lives in
 * the editor's own stacking context.
 */
export const autocompleteTooltipTheme: Extension = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "var(--radius-md)",
    // Tailwind shadow-md (no --shadow-* token exists yet).
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
    fontSize: "14px",
    zIndex: "40",
  },
  ".cm-tooltip-autocomplete": {
    overflow: "hidden",
    // Viewport clamps keep the popover usable on narrow/mobile screens.
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
    minHeight: "40px",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    lineHeight: "20px",
  },
  ".cm-tooltip-autocomplete > ul > li:hover": {
    backgroundColor: "hsl(var(--muted) / 0.6)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected=\"true\"]": {
    backgroundColor: "hsl(var(--primary) / 0.15)",
    fontWeight: "600",
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "700",
    color: "hsl(var(--primary))",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "12px",
    fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
    fontSize: "12px",
    fontStyle: "normal",
    color: "hsl(var(--muted-foreground))",
  },
  "@media (pointer: coarse)": {
    ".cm-tooltip-autocomplete > ul > li": { minHeight: "48px" },
  },
});
