/**
 * Link Preview & Smart Link Authoring
 *
 * Replaces external and internal workspace links in Markdown note prose with
 * Utilitarian Minimalism link pills:
 *  - Markdown links `[label](https://...)` and `[label](/workspace/path)`
 *  - Wiki links `[[target]]` and `[[target|Label]]`
 *  - Bare URLs `https://...`
 *  - Smart URL paste over non-empty prose selections (`[selected](pastedUrl)`)
 *  - Inline popover on pill click (`Open`, `Edit`, `Unlink`)
 *
 * Image syntax `![alt](url)` is explicitly excluded so `embedPreviewDecorations`
 * owns inline media rendering cleanly.
 */

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { EditorSelection, StateField, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { activeCursorSection, sectionField } from "./section-state";
import { isEditorFocused, setEditorFocused } from "./editor-focus";
import { isNavigableUrl, navigationFacet } from "./link-open";

// Negative lookbehind `(?<!!)` ensures `![alt](url)` images are never matched as links.
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|#[^)\s]+|wod:[^)\s]+)\)/g;
const WIKI_LINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const BARE_URL_RE = /https?:\/\/\S+/g;
const CODE_SPAN_RE = /`[^`\n]*`/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>'"]$/;

function extractYouTubeVideoId(url: string): string | null {
  const standard = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (standard) return standard[1];
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (short) return short[1];
  const embed = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embed) return embed[1];
  return null;
}

function isExternalHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function createLinkArrowIcon(isExternal: boolean): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "h-3 w-3");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  if (isExternal) {
    // Crisp north-east arrow (↗)
    path.setAttribute("d", "M4.5 11.5L11.5 4.5M6 4.5H11.5V10");
  } else {
    // Crisp internal forward arrow (→)
    path.setAttribute("d", "M3.5 8H12.5M8.5 4L12.5 8L8.5 12");
  }
  svg.appendChild(path);
  return svg;
}

let activePopoverCleanup: (() => void) | null = null;

function closeActiveLinkPopover(): void {
  if (activePopoverCleanup) {
    activePopoverCleanup();
    activePopoverCleanup = null;
  }
}

function openLinkEditPopover(
  anchorEl: HTMLElement,
  view: EditorView,
  match: LinkMatch,
): void {
  closeActiveLinkPopover();
  if (typeof document === "undefined") return;

  const popover = document.createElement("div");
  popover.className = "cm-link-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Edit link");

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.value = match.label;
  labelInput.placeholder = "Label";
  labelInput.setAttribute("aria-label", "Link label");
  labelInput.className = "cm-link-popover-input";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.value = match.url;
  urlInput.placeholder = "https:// or /notes/...";
  urlInput.setAttribute("aria-label", "Link destination");
  urlInput.className = "cm-link-popover-input cm-link-popover-url";

  const actions = document.createElement("div");
  actions.className = "cm-link-popover-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "cm-link-popover-btn";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const targetUrl = urlInput.value.trim() || match.url;
    closeActiveLinkPopover();
    const navHook = view.state.facet(navigationFacet);
    if (!isExternalHttpUrl(targetUrl) && navHook) {
      navHook(targetUrl, view);
    } else if (typeof window !== "undefined") {
      window.open(
        targetUrl,
        isExternalHttpUrl(targetUrl) ? "_blank" : "_self",
        isExternalHttpUrl(targetUrl) ? "noopener,noreferrer" : undefined,
      );
    }
  });

  const unlinkBtn = document.createElement("button");
  unlinkBtn.type = "button";
  unlinkBtn.className = "cm-link-popover-btn";
  unlinkBtn.textContent = "Unlink";
  unlinkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const plainText = labelInput.value.trim() || match.label || match.url;
    closeActiveLinkPopover();
    if (match.to <= view.state.doc.length) {
      view.dispatch({
        changes: { from: match.from, to: match.to, insert: plainText },
        userEvent: "input.unlink",
      });
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "cm-link-popover-btn cm-link-popover-btn-primary";
  saveBtn.textContent = "Apply";
  const applyChanges = () => {
    const nextLabel = labelInput.value.trim();
    const nextUrl = urlInput.value.trim();
    closeActiveLinkPopover();
    if (!nextUrl || match.to > view.state.doc.length) return;
    const formatted =
      nextLabel && nextLabel !== nextUrl
        ? `[${nextLabel}](${nextUrl})`
        : `[${nextUrl}](${nextUrl})`;
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: formatted },
      userEvent: "input.link",
    });
  };
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyChanges();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      applyChanges();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeActiveLinkPopover();
    }
  };
  labelInput.addEventListener("keydown", handleKeyDown);
  urlInput.addEventListener("keydown", handleKeyDown);

  actions.appendChild(openBtn);
  actions.appendChild(unlinkBtn);
  actions.appendChild(saveBtn);
  popover.appendChild(labelInput);
  popover.appendChild(urlInput);
  popover.appendChild(actions);

  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 130, rect.bottom + 6);
  const left = Math.max(8, Math.min(window.innerWidth - 280, rect.left));
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${left}px`;

  const onOutsidePointer = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
      closeActiveLinkPopover();
    }
  };
  document.addEventListener("mousedown", onOutsidePointer, true);

  activePopoverCleanup = () => {
    document.removeEventListener("mousedown", onOutsidePointer, true);
    popover.remove();
  };

  labelInput.focus();
  labelInput.select();
}

/** Inline pill: flat bordered link with external or workspace-open action. */
class LinkPillWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string,
    readonly from: number,
    readonly to: number,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: LinkPillWidget): boolean {
    return (
      this.label === other.label &&
      this.url === other.url &&
      this.from === other.from &&
      this.to === other.to &&
      this.readOnly === other.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const isExternal = isExternalHttpUrl(this.url);
    const pill = document.createElement("span");
    pill.className = isExternal
      ? "cm-link-pill"
      : "cm-link-pill cm-link-pill-internal";

    const label = document.createElement("span");
    label.className = "cm-link-pill-label";
    label.textContent = this.label || this.url;
    if (!this.readOnly) {
      label.title = "Click to edit or open link";
      label.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      label.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLinkEditPopover(pill, view, {
          from: this.from,
          to: this.to,
          label: this.label,
          url: this.url,
        });
      });
    }
    pill.appendChild(label);

    const open = document.createElement("a");
    open.className = "cm-link-pill-open";
    open.href = this.url;
    if (isExternal) {
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.setAttribute("aria-label", `Open ${this.label || this.url} in new tab`);
    } else {
      open.setAttribute("aria-label", `Open ${this.label || this.url}`);
      open.addEventListener("click", (e) => {
        const navHook = view.state.facet(navigationFacet);
        if (navHook) {
          e.preventDefault();
          e.stopPropagation();
          navHook(this.url, view);
        }
      });
    }
    open.title = this.url;
    open.appendChild(createLinkArrowIcon(isExternal));
    pill.appendChild(open);

    return pill;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Block-level YouTube player shown when the cursor is off the line. */
class YouTubePlayerWidget extends WidgetType {
  constructor(
    readonly videoId: string,
    readonly title: string,
  ) {
    super();
  }

  eq(other: YouTubePlayerWidget): boolean {
    return this.videoId === other.videoId && this.title === other.title;
  }

  toDOM(): HTMLElement {
    const outer = document.createElement("div");
    outer.className = "cm-youtube-player-outer py-2";

    const wrap = document.createElement("div");
    wrap.className = "cm-youtube-player";

    const iframe = document.createElement("iframe");
    iframe.className = "cm-youtube-player-frame";
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(this.videoId)}`;
    iframe.title = this.title || "YouTube video";
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("loading", "lazy");
    wrap.appendChild(iframe);
    outer.appendChild(wrap);

    return outer;
  }

  get block(): boolean {
    return true;
  }
}

interface LinkMatch {
  from: number;
  to: number;
  label: string;
  url: string;
}

function findLineLinks(line: { from: number; text: string }): LinkMatch[] {
  const links: LinkMatch[] = [];
  const protectedSpans: [number, number][] = [];

  let match: RegExpExecArray | null;
  CODE_SPAN_RE.lastIndex = 0;
  while ((match = CODE_SPAN_RE.exec(line.text)) !== null) {
    protectedSpans.push([match.index, match.index + match[0].length]);
  }
  // Protect `![alt](url)` image embeds from bare-URL and link matching
  const imageRe = /!\[[^\]]*\]\([^)\s]+\)/g;
  while ((match = imageRe.exec(line.text)) !== null) {
    protectedSpans.push([match.index, match.index + match[0].length]);
  }

  const inProtected = (index: number) =>
    protectedSpans.some(([a, b]) => index >= a && index < b);

  MD_LINK_RE.lastIndex = 0;
  while ((match = MD_LINK_RE.exec(line.text)) !== null) {
    if (inProtected(match.index)) continue;
    if (!isNavigableUrl(match[2])) continue;
    links.push({
      from: line.from + match.index,
      to: line.from + match.index + match[0].length,
      label: match[1],
      url: match[2],
    });
  }

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(line.text)) !== null) {
    if (inProtected(match.index)) continue;
    const found = match;
    if (links.some((l) => found.index >= l.from - line.from && found.index < l.to - line.from)) continue;
    const rawTarget = found[1].trim();
    const display = (found[2] ?? rawTarget).trim();
    const slugified = rawTarget
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const url = rawTarget.startsWith("/")
      ? rawTarget
      : `/notes/${encodeURIComponent(slugified || rawTarget)}`;
    links.push({
      from: line.from + found.index,
      to: line.from + found.index + found[0].length,
      label: display,
      url,
    });
  }

  BARE_URL_RE.lastIndex = 0;
  while ((match = BARE_URL_RE.exec(line.text)) !== null) {
    if (inProtected(match.index)) continue;
    const found = match;
    if (links.some((l) => found.index >= l.from - line.from && found.index < l.to - line.from)) continue;
    let url = found[0];
    while (TRAILING_PUNCT_RE.test(url)) url = url.slice(0, -1);
    if (!url) continue;
    links.push({
      from: line.from + found.index,
      to: line.from + found.index + url.length,
      label: url,
      url,
    });
  }

  return links.sort((a, b) => a.from - b.from);
}

function buildLinkDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { sections } = state.field(sectionField);
  const sel = state.selection.main;
  const canRevealRaw = !state.readOnly && isEditorFocused(state);

  for (const section of sections) {
    if (section.type !== "markdown" && section.type !== "embed") continue;
    if (section.type === "markdown" && section.subtype === "table") continue;
    // Skip standalone image embeds (owned by embedPreviewDecorations)
    if (section.type === "embed" && section.embed?.type === "image") continue;

    for (let l = section.startLine; l <= section.endLine; l++) {
      const line = state.doc.line(l);
      if (line.text.trim().startsWith("|")) continue;
      if (canRevealRaw && sel.from <= line.to && sel.to >= line.from) continue;

      const links = findLineLinks(line);
      const trimmed = line.text.trimStart();
      const leading = line.text.length - trimmed.length;
      const trailing = line.text.length - line.text.trimEnd().length;
      const bodyStart = leading + (trimmed.match(/^[-*+]\s+/)?.[0].length ?? 0);

      for (const link of links) {
        const wholeLine =
          links.length === 1 &&
          link.from === line.from + bodyStart &&
          link.to === line.to - trailing;
        const videoId = wholeLine ? extractYouTubeVideoId(link.url) : null;

        if (videoId) {
          builder.add(
            line.from,
            line.to,
            Decoration.replace({ widget: new YouTubePlayerWidget(videoId, link.label), block: true }),
          );
        } else {
          builder.add(
            link.from,
            link.to,
            Decoration.replace({
              widget: new LinkPillWidget(
                link.label,
                link.url,
                link.from,
                link.to,
                state.readOnly,
              ),
            }),
          );
        }
      }
    }
  }

  return builder.finish();
}

export function handleSmartUrlPaste(event: ClipboardEvent, view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const section = activeCursorSection(view.state);
  if (section && section.type !== "markdown") return false;

  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  const selectedText = view.state.doc.sliceString(from, to);
  if (selectedText.includes("\n")) return false;

  const pasted = event.clipboardData?.getData("text/plain")?.trim() ?? "";
  if (!/^https?:\/\/\S+$/i.test(pasted) && !/^\/[a-zA-Z0-9/_-]+$/.test(pasted)) {
    return false;
  }

  event.preventDefault();
  const formatted = `[${selectedText}](${pasted})`;
  view.dispatch({
    changes: { from, to, insert: formatted },
    selection: EditorSelection.cursor(from + formatted.length),
    userEvent: "input.paste",
  });
  return true;
}

const smartLinkPasteHandler = EditorView.domEventHandlers({
  paste: handleSmartUrlPaste,
});

const linkPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildLinkDecos(state);
  },
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setEditorFocused))
    ) {
      return buildLinkDecos(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const linkPreviewTheme = EditorView.baseTheme({
  ".cm-link-pill": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 6px",
    border: "1px solid hsl(var(--border))",
    borderRadius: "4px",
    backgroundColor: "hsl(var(--card))",
    maxWidth: "100%",
    verticalAlign: "baseline",
  },
  ".cm-link-pill-internal": {
    backgroundColor: "hsl(var(--muted) / 0.45)",
  },
  ".cm-link-pill-label": {
    color: "hsl(var(--foreground))",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  ".cm-link-pill-open": {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: "0",
    color: "hsl(var(--muted-foreground))",
    textDecoration: "none",
    cursor: "pointer",
  },
  ".cm-link-pill-open:hover": {
    color: "hsl(var(--foreground))",
  },
  ".cm-youtube-player": {
    width: "100%",
    aspectRatio: "16 / 9",
    backgroundColor: "#000",
    borderRadius: "8px",
    border: "1px solid hsl(var(--border))",
    overflow: "hidden",
  },
  ".cm-youtube-player-frame": {
    display: "block",
    width: "100%",
    height: "100%",
    border: "none",
  },
  ".cm-link-popover": {
    position: "fixed",
    zIndex: "60",
    width: "268px",
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
    fontFamily: 'var(--font-sans, "Geist Sans", system-ui, sans-serif)',
  },
  ".cm-link-popover-input": {
    width: "100%",
    height: "28px",
    padding: "0 8px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    outline: "none",
    boxSizing: "border-box",
  },
  ".cm-link-popover-url": {
    fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
    fontSize: "11px",
  },
  ".cm-link-popover-actions": {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
  },
  ".cm-link-popover-btn": {
    height: "24px",
    padding: "0 8px",
    fontSize: "11px",
    fontWeight: "500",
    borderRadius: "4px",
    border: "1px solid hsl(var(--border))",
    backgroundColor: "transparent",
    color: "hsl(var(--foreground))",
    cursor: "pointer",
  },
  ".cm-link-popover-btn-primary": {
    backgroundColor: "hsl(var(--foreground))",
    color: "hsl(var(--background))",
    borderColor: "hsl(var(--foreground))",
  },
});

export const linkPreview: Extension = [
  linkPreviewField,
  smartLinkPasteHandler,
  linkPreviewTheme,
];
