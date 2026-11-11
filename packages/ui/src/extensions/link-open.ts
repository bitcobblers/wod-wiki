import { Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

export type NavigationHook = (url: string, view: EditorView) => void;

export const navigationFacet = Facet.define<NavigationHook, NavigationHook | null>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

export function isNavigableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return false;
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#")
  );
}

export function urlAtPos(view: EditorView, pos: number): string | null {
  const tree = syntaxTree(view.state);
  let foundUrl: string | null = null;

  tree.cursorAt(pos).iterate((node) => {
    if (node.name === "URL") {
      const text = view.state.doc.sliceString(node.from, node.to);
      if (isNavigableUrl(text)) {
        foundUrl = text;
        return false;
      }
    }
    if (node.name === "Autolink") {
      let text = view.state.doc.sliceString(node.from, node.to);
      if (text.startsWith("<") && text.endsWith(">")) {
        text = text.slice(1, -1);
      }
      if (isNavigableUrl(text)) {
        foundUrl = text;
        return false;
      }
    }
  });

  if (foundUrl) return foundUrl;

  // Fallback for wiki-links `[[target]]` or unparsed markdown links on line
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  const mdLinkRe = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(line.text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length && isNavigableUrl(m[2])) {
      return m[2];
    }
  }
  const wikiRe = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
  while ((m = wikiRe.exec(line.text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      const target = m[1].trim();
      return target.startsWith("/") ? target : `/notes/${encodeURIComponent(target)}`;
    }
  }

  return null;
}

const linkHoverTooltip = hoverTooltip(
  (view, pos) => {
    const url = urlAtPos(view, pos);
    if (!url) return null;

    return {
      pos,
      end: pos,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className =
          "cm-link-tooltip px-2 py-1 text-[11px] text-muted-foreground bg-card border border-border rounded-[4px] flex items-center gap-1.5";
        const kbd = document.createElement("kbd");
        kbd.className = "px-1 py-0.5 rounded-[3px] bg-muted border border-border font-mono text-[10px]";
        kbd.textContent = "Ctrl";
        const text = document.createElement("span");
        text.textContent = "+Click to open link";
        dom.appendChild(kbd);
        dom.appendChild(text);
        return { dom };
      },
    };
  },
  { hoverTime: 300 },
);

const ctrlClickPlugin = ViewPlugin.fromClass(
  class {
    private handler: (e: MouseEvent) => void;
    private view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.handler = (e: MouseEvent) => {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;

        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return;

        const url = urlAtPos(view, pos);
        if (!url) return;

        e.preventDefault();
        e.stopPropagation();

        const navHook = view.state.facet(navigationFacet);
        if (navHook) {
          navHook(url, view);
        } else if (typeof window !== "undefined") {
          const isInternal = url.startsWith("/") || url.startsWith("#");
          window.open(url, isInternal ? "_self" : "_blank", isInternal ? undefined : "noopener,noreferrer");
        }
      };

      view.dom.addEventListener("mousedown", this.handler, true);
    }

    destroy() {
      this.view.dom.removeEventListener("mousedown", this.handler, true);
    }

    update(_update: ViewUpdate) {}
  },
);

const linkCursorTheme = EditorView.domEventHandlers({
  mousemove(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const url = urlAtPos(view, pos);
    view.dom.style.cursor = url && (e.ctrlKey || e.metaKey) ? "pointer" : "";
    return false;
  },
  keydown(_e, view) {
    view.dom.style.cursor = "";
    return false;
  },
});

export const linkOpen: Extension = [
  linkHoverTooltip,
  ctrlClickPlugin,
  linkCursorTheme,
];
