import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";

export function editorTheme(isDark: boolean, dialect = "markdown"): Extension {
  const isCodeDialect =
    dialect === "wod" ||
    dialect === "whiteboard" ||
    dialect === "time" ||
    dialect === "log" ||
    dialect === "wql";

  const baseTheme = EditorView.theme({
    "&": {
      height: "auto",
      minHeight: "100%",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      fontSize: "14px",
      textAlign: "left",
      color: "hsl(var(--foreground))",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      overflow: "visible",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      fontFamily: "inherit",
    },
    ".cm-content": {
      fontFamily: isCodeDialect
        ? 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)'
        : 'var(--font-sans, "Geist Sans", "SF Pro Display", Switzer, "Helvetica Neue", system-ui, sans-serif)',
      lineHeight: "22px",
      padding: "0",
      margin: "0 3px",
      textAlign: "left",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "hsl(var(--muted-foreground) / 0.65)",
      border: "none",
      padding: "0",
      fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, monospace)',
      fontSize: "11px",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-activeLine": {
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.035)" : "rgba(17, 17, 17, 0.028)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "hsl(var(--foreground))",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(17, 17, 17, 0.11)",
    },
    ".cm-selectionBackground": {
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 17, 17, 0.07)",
    },
    "::selection": {
      backgroundColor: isDark ? "rgba(255, 255, 255, 0.18) !important" : "rgba(17, 17, 17, 0.14) !important",
    },
  }, { dark: isDark });

  return isDark ? [oneDark, baseTheme] : [baseTheme];
}
