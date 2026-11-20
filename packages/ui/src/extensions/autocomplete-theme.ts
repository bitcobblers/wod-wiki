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
    borderRadius: "8px",
    boxShadow: "0 10px 28px -8px hsl(var(--foreground) / 0.14), 0 2px 6px hsl(var(--foreground) / 0.06)",
    fontFamily: 'var(--font-sans, "Geist Sans", "SF Pro Display", Switzer, "Helvetica Neue", system-ui, sans-serif)',
    fontSize: "13px",
    zIndex: "45",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    overflow: "hidden",
    minWidth: "min(20rem, calc(100vw - 2rem))",
    maxWidth: "min(26rem, calc(100vw - 2rem))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete.cm-wod-tooltip-docked-hidden": {
    display: "none",
  },
  // Specificity (0,3,1)+ overrides CM6's base `.cm-tooltip.cm-tooltip-autocomplete > ul` (10em cap).
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    padding: "4px",
    margin: "0",
    maxHeight: "min(45svh, 20rem)",
    overscrollBehavior: "contain",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block",
    padding: "6px 10px 3px",
    fontSize: "10px",
    fontWeight: "600",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "hsl(var(--muted-foreground))",
    borderBottom: "none",
    opacity: "1",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section:not(:first-child)": {
    marginTop: "4px",
    paddingTop: "8px",
    borderTop: "1px solid hsl(var(--border) / 0.65)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "34px",
    padding: "6px 10px",
    borderRadius: "6px",
    lineHeight: "20px",
    cursor: "pointer",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li:hover": {
    backgroundColor: "hsl(var(--muted) / 0.55)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected=\"true\"]": {
    backgroundColor: "hsl(var(--muted))",
    color: "hsl(var(--foreground))",
    fontWeight: "600",
  },
  ".cm-tooltip.cm-tooltip-autocomplete::after": {
    content: '"Tab accept · ↑↓ navigate · Enter newline · Esc close"',
    display: "block",
    padding: "5px 10px",
    borderTop: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--muted) / 0.4)",
    fontSize: "11px",
    lineHeight: "16px",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-tooltip.cm-completionInfo": {
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    boxShadow: "0 10px 28px -8px hsl(var(--foreground) / 0.14), 0 2px 6px hsl(var(--foreground) / 0.06)",
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
    fontSize: "12px",
    lineHeight: "18px",
    whiteSpace: "pre",
    maxWidth: "min(22rem, calc(100vw - 2rem))",
  },
  ".cm-wod-ac-icon": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    flexShrink: "0",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-wod-ac-icon--effort": {
    color: "hsl(var(--metric-effort, var(--primary)))",
  },
  ".cm-wod-ac-icon--unit": {
    color: "hsl(var(--metric-resistance, var(--primary)))",
  },
  ".cm-wod-ac-icon--tag": {
    color: "hsl(var(--metric-action, var(--primary)))",
  },
  ".cm-wod-ac-icon--keyword": {
    color: "hsl(var(--metric-time, var(--primary)))",
  },
  ".cm-wod-ac-icon--template": {
    color: "hsl(var(--metric-rounds, var(--primary)))",
  },
  ".cm-wod-ac-icon--property": {
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-wod-ac-icon--create": {
    color: "hsl(var(--primary))",
  },
  ".cm-wod-ac-icon--link": {
    color: "hsl(var(--primary))",
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
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { minHeight: "48px" },
    ".cm-tooltip.cm-tooltip-autocomplete::after": { display: "none" },
  },
});
