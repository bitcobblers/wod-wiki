/**
 * FrontmatterCompanion
 *
 * Overlay companion for embed sections (YouTube players, link/image previews).
 *
 * Property editing for frontmatter documents — effort/equipment definitions
 * and generic properties — lives INLINE in the reading column via the
 * frontmatter preview widget (packages/ui), which edits the same
 * CodeMirror document through the shared source patch helper. This companion
 * deliberately renders no property forms: a detached side form would
 * duplicate the inline editor and fork the undo path.
 */

import React, { useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { sectionField, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { parseFlatProperties, extractYouTubeVideoId } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────

function getSection(view: EditorView, sectionId: string): EditorSection | undefined {
  const { sections } = view.state.field(sectionField);
  return sections.find((s) => s.id === sectionId);
}

function getSectionInnerContent(view: EditorView, section: EditorSection): string {
  if (section.contentFrom === undefined || section.contentTo === undefined) return "";
  return view.state.doc.sliceString(section.contentFrom, section.contentTo);
}

// ── Components ───────────────────────────────────────────────────────

export interface FrontmatterCompanionProps {
  sectionId: string;
  section?: EditorSection;
  view: EditorView;
  isActive: boolean;
  widthPercent: number;
  docVersion: number;
}

const LinkFrontmatterCompanion: React.FC<{
  props: Record<string, string>;
  isActive: boolean;
}> = ({ props, isActive }) => {
  const url = props.source_url || props.website || "";
  const title = props.title || props.label || "Link";
  const compact = !isActive;

  return (
    <div className={cn("h-full w-full flex flex-col bg-popover/90 backdrop-blur-sm border-l border-border overflow-auto", compact ? "p-2" : "p-3")}>
      <div className="flex items-center gap-2 mb-1">
        <span className="rounded bg-blue-500/10 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">
          Link
        </span>
        <span className="truncate text-xs font-medium">{title}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 truncate text-[10px] text-blue-400 dark:text-blue-300 hover:underline"
        title={url}
      >
        {url}
      </a>
      {!compact && (
        <div className="rounded-md border border-border/70 bg-background/70 p-2 text-[11px] text-muted-foreground">
          External link preview. Click the URL above to open in a new tab.
        </div>
      )}
    </div>
  );
};

// ── Main component ──────────────────────────────────────────────────

export const FrontmatterCompanion: React.FC<FrontmatterCompanionProps> = ({
  sectionId,
  section: propSection,
  view,
  isActive,
}) => {
  const section = useMemo(
    () => propSection || getSection(view, sectionId),
    [view, sectionId, propSection],
  );

  const rawContent = section ? getSectionInnerContent(view, section) : '';
  const props = useMemo(() => parseFlatProperties(rawContent), [rawContent]);

  if (!section) return null;

  // 1. Dedicated embed sections keep their rich preview.
  if (section.type === "embed" && section.embed) {
    const { type, url, label } = section.embed;
    if (type === "youtube") {
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        return (
          <YouTubePlayer
            videoId={videoId}
            title={label}
            isActive={isActive}
          />
        );
      }
    }

    return (
      <div className="h-full w-full flex flex-col bg-popover/90 backdrop-blur-sm border-l border-border p-3 overflow-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 uppercase font-bold">
            {section.embed.isImage ? "IMAGE" : "LINK"}
          </span>
          <span className="text-xs font-medium truncate">{label || "Untitled"}</span>
        </div>
        <div className="text-[10px] text-muted-foreground truncate mb-3">{url}</div>
        {section.embed.isImage && (
          <img src={url} alt={label} className="w-full h-auto rounded border border-border shadow-sm bg-muted/20" />
        )}
      </div>
    );
  }

  // 2. Frontmatter sections: inline properties (the frontmatter preview
  //    widget) are the single editing surface; the companion only renders
  //    preview affordances for link/YouTube documents.
  const typeValue = (props.type || "").toLowerCase();
  const url = props.url || props.link || "";
  if (typeValue === "youtube") {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      return <YouTubePlayer videoId={videoId} title={props.title || "YouTube Video"} isActive={isActive} />;
    }
  }

  if (props.source_url || props.website || typeValue === "strava") {
    return <LinkFrontmatterCompanion props={props} isActive={isActive} />;
  }

  // Effort/equipment definitions and generic properties edit inline.
  return null;
};

// ── YouTube sub-component ────────────────────────────────────────────

const YouTubePlayer: React.FC<{
  videoId: string;
  title: string;
  isActive: boolean;
}> = ({ videoId, title, isActive }) => {
  return (
    <div className={cn("h-full w-full flex flex-col", isActive ? "bg-popover/90 backdrop-blur-sm border-l border-border" : "bg-black dark:bg-black")}>
      <div className="relative flex-1 min-h-0">
        <iframe
          className="absolute inset-0 w-full h-full border-0"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
      {isActive && title && title !== "YouTube Video" && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground truncate border-t border-border bg-popover/90">
          {title}
        </div>
      )}
    </div>
  );
};
