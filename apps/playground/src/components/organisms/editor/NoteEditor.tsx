/**
 * NoteEditor
 * 
 * Single-instance CodeMirror 6 editor for the entire document.
 * Replaces the fragmented SectionEditor approach with a cohesive
 * editing experience where blocks are rendered as previews when
 * unfocused and transition to raw source on focus.
 * 
 * Per ADR: "Standardize the editor on a single CodeMirror 6 instance
 * for the entire document content."
 * 
 * Per PRD: "Eliminate Disjointedness — Transition from a multi-component
 * SectionEditor to a single, highly-extensible CodeMirror 6 instance."
 */

import { getTagIndex } from '@/hooks/useBrowserServices';
import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useOptionalNavigate } from "@/hooks/useOptionalNavigate";
import type { SessionActionContext } from "@bitcobblers/wod-wiki-ui";
import { sessionDetailPath } from "@/lib/routes";
import { AddToDashboardSheet } from "../../../../app/views/analytics/AddToDashboardSheet";
import { Annotation, EditorState, StateEffect, type Extension } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  highlightSpecialChars,
  lineNumbers,
  highlightActiveLineGutter,
  placeholder,
  tooltips,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
} from "@codemirror/commands";
import { indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { completionKeymap, completionStatus, closeCompletion, closeBrackets, closeBracketsKeymap, selectedCompletionIndex, startCompletion } from "@codemirror/autocomplete";
import { EFFORT_DISCIPLINES } from "@bitcobblers/wod-wiki-lang";
import { lintKeymap } from "@codemirror/lint";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";

import { editorTheme, editorFocusTracker, navigationFacet, affiliateTagFacet } from '@bitcobblers/wod-wiki-ui/extensions';

/** Marks programmatic dispatches from NoteEditor's controlled `value` prop sync effect. */
const externalValueSyncAnnotation = Annotation.define<boolean>();
import { ASSOCIATE_TAG } from '@/lib/affiliateLink';
import { smartIncrement } from '@bitcobblers/wod-wiki-ui/extensions';

// Note editor extensions
import { sectionField, SectionState, activeCursorSection, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { sectionIdentity, sectionIdentityHistory, registeredSectionWidgets, sectionSaved, sectionRestore } from '@bitcobblers/wod-wiki-ui/extensions';
import type { NoteBlock } from '@/types/storage';
import { reconcileNoteBlocks, validateNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { captureRun, type CapturedRun, createResultRecorder, captureMetricCorrection, captureSessionRpe } from '@/hooks/useBrowserServices';
import { sessionQueryInsert } from '@bitcobblers/wod-wiki-ui/extensions';
import { previewDecorations } from '@bitcobblers/wod-wiki-ui/extensions';
import { embedPreviewDecorations } from '@bitcobblers/wod-wiki-ui/extensions';
import { frontmatterPreview, frontmatterVisibility, frontmatterDebugMode } from '@bitcobblers/wod-wiki-ui/extensions';
import { markdownTablePreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { linkPreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { markdownSyntaxHiding } from '@bitcobblers/wod-wiki-ui/extensions';
import { wodLinter } from '@bitcobblers/wod-wiki-ui/extensions';
import {
  wodAutocompletion,
  wodCompletionKeymap,
  wodIndentKeymap,
  wodEditorKeymap,
  wodAutoWrap,
  autocompleteTooltipTheme,
  customCompletionSources,
  mobileDockedCompletionFacet,
  nestedCompletionOptions,
  resolveCodeLanguage,
  type CustomCompletionSource,
  type NestedCompletionOptions,
} from '@bitcobblers/wod-wiki-ui/extensions';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { storageService } from '@/hooks/useBrowserServices';
import { wodOverlayPanel } from '@bitcobblers/wod-wiki-ui/extensions';
import { widgetBlockPreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { queryBlockPreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { type ButtonAction } from '@bitcobblers/wod-wiki-ui/extensions';
import { sectionGeometry } from '@bitcobblers/wod-wiki-ui/extensions';
import { linkOpen } from '@bitcobblers/wod-wiki-ui/extensions';
import { gutterUnified } from '@bitcobblers/wod-wiki-ui/extensions';
import { lineIdsExtension } from '@bitcobblers/wod-wiki-ui/extensions';
import { cursorFocusExtension } from "@/app/editor/cursorFocusExtension";

import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { INotePersistence } from "@/services/persistence";
import { queryService, onResultSaved } from "@/hooks/useCastSignaling";
import { catalogueReload } from "@/app/editor/catalogueReload";
import {
  createAttachmentUrlExtension,
  createFileDropHandler,
  createFrontmatterSuggestions,
  createFrontmatterReferenceProvider,
  createInlineEffortFromToken,
  createInlineTagFromSlug,
  createMarkdownProseCompletionSource,
  loadReferenceCatalog,
  resolveNotePersistence,
  buildNestedCompletionOptions,
} from "@/app/editor/noteEditorServices";

import { entryOpenHref } from '../../../../app/lib/entryActions';
import { toEntry, blockToEntry } from '../../../../app/lib/entryMapper';
import * as NavContextModule from '../../../../app/nav/NavContext';
import { OverlayTrack } from "@/components/organisms/editor/OverlayTrack";
import { useOverlayWidthState } from "@/components/Editor/overlays/useOverlayWidthState";
import type { OverlaySlotProps } from "@/components/organisms/editor/OverlayTrack";
import { useDebugMode } from "@/contexts/DebugModeContext";
import { FrontmatterCompanion } from "@/components/organisms/editor/FrontmatterCompanion";
import { WhiteboardCompanion } from "@/components/organisms/editor/WhiteboardCompanion";
import { WidgetCompanion } from "@/components/organisms/editor/WidgetCompanion";
import type { WidgetRegistry } from "@/components/Editor/widgets/types";
import type { ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import { FullscreenTimer } from "@/components/organisms/review/FullscreenTimer";
import { HaltedRunNotice } from "@/components/organisms/editor/RuntimeTimerPanel";
import { InlineCommandBar } from "@/components/organisms/editor/InlineCommandBar";
import { EditorCastBridge } from "@/components/organisms/editor/EditorCastBridge";
import { MetricInlinePanel } from "@/components/organisms/editor/MetricInlinePanel";
import { MobileWheelComposer } from "@/components/organisms/editor/MobileWheelComposer";
import { revealMobileEditRow } from "@/components/organisms/editor/mobileEditViewport";
import { SelectionFormatBar } from "@/components/organisms/editor/SelectionFormatBar";
import {
  loadNotebookScopeSnapshot,
  type NotebookScopeSnapshot,
} from "@/components/organisms/editor/wheelSources";
import {
  extractLineTokens,
  type EditDiffSummary,
  type InspectorMode,
  type InspectorToken,
  type LineInspection,
} from "@/components/organisms/editor/whiteboard-inspector/tokenModel";
import { WhiteboardInspectorPopover } from "@/components/organisms/editor/whiteboard-inspector/WhiteboardInspectorPopover";
import { WhiteboardInspectorDrawer } from "@/components/organisms/editor/whiteboard-inspector/WhiteboardInspectorDrawer";
import { v7 as uuidv7 } from "uuid";

import { themeCompartment, languageCompartment, modeCompartment, inputModeCompartment } from "@/components/Editor/compartments";

import type { ScriptBlock } from "@/components/Editor/types";
import { Play, Plus, ExternalLink, Copy, Check } from "lucide-react";
import { buildHomeShareUrl, buildPlaygroundUrl } from "@/components/atoms/WhiteboardPlaygroundButton";
import { registerActiveEditorBridge, type EditorInspectorSnapshot } from "@/agent/surfaceBridges";

export interface NoteEditorProps {
  /** Note ID for result lookup */
  noteId?: string;
  noteBlocks?: Record<string, NoteBlock>;
  sourceRevision?: number;
  onIdentityChange?: (snapshot: EditorIdentitySnapshot) => void;
  onSaved?: (snapshot: EditorIdentitySnapshot) => void;
  beforeRun?: () => Promise<number | void>;
  /** Called when the user presses Ctrl/Cmd+S — the host flushes the pending save. */
  onSaveRequest?: () => void | Promise<void>;
  /**
   * Called when the document changed WITHOUT a typing user-event — widget
   * commits (frontmatter rows), query-block inserts, undo/redo. Typing stays
   * coalesced (line change / blur / Ctrl+S); these commits save immediately.
   */
  onCommitChange?: () => void | Promise<void>;
  /** Document content */
  value: string;
  /** Called on every document change */
  onChange: (value: string) => void;
  /** Called on document change with the full ViewUpdate for tracking edits and coordinate changes */
  onDocUpdate?: (update: ViewUpdate) => void;
  /** Called when cursor position changes */
  onCursorPositionChange?: (line: number, column: number) => void;
  /** Called when the editor loses focus */
  onBlur?: () => void;
  /** Editor theme ("vs" | "dark") */
  theme?: string;
  /** Read-only mode */
  readonly?: boolean;
  /** CSS class name */
  className?: string;
  /** Accessible name for the CodeMirror textbox */
  ariaLabel?: string;
  /** Called when user triggers "Run" on a Whiteboard Script block */
  onStartWorkout?: (block: ScriptBlock) => void;
  /** Called when a workout is completed with the results.
   * `resultId` is the id the editor generated for the optimistic result and
   * used in the inserted query:table block — persistence MUST reuse it (#944).
   * `runBlock` is the section-derived identity (id + contentId) of the block
   * that just completed. May return a promise (the save) for commit-gated
   * dismissal in the overlay. */
  onCompleteWorkout?: (blockId: string, results: ScriptBlock["results"], resultId?: string, runBlock?: Pick<ScriptBlock, "id" | "contentId">) => void | Promise<unknown>;
  /** Called when Whiteboard Script blocks change */
  onBlocksChange?: (blocks: ScriptBlock[]) => void;
  /** Called when user triggers "Add to Plan" on a Whiteboard Script block */
  onAddToPlan?: (block: ScriptBlock) => void;
  /** Note persistence seam used for result and attachment projections */
  notePersistence?: INotePersistence;
  /** Optional in-memory workout results override */
  results?: Session[];
  /** Exposed EditorView ref */
  onViewCreated?: (view: EditorView) => void;
  /** Editor mode */
  mode?: "edit" | "track" | "data";
  /** Enable line wrapping */
  lineWrapping?: boolean;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Enable block-level preview (default: true) */
  enablePreview?: boolean;
  /** Show frontmatter and its property/tag controls (default: true). Hidden metadata stays in the document. */
  showFrontmatter?: boolean;
  /** Enable Whiteboard Script linting (default: true) */
  enableLinting?: boolean;
  /** Enable overlay panel (default: true) */
  enableOverlay?: boolean;
  /**
   * Command buttons shown on Whiteboard Script block overlays.
   * When provided, replaces the individual onStartWorkout / onAddToPlan callbacks
   * (those are still accepted for backward compatibility when commands is omitted).
   */
  hideDefaultCommands?: boolean;
  commands?: ScriptCommand[];
  /**
   * When true (default), clicking "Run" opens an inline runtime panel below
   * the workout block instead of calling onStartWorkout / navigating to the track
   * route.  Set to false to restore the previous route-based behaviour.
   */
  enableInlineRuntime?: boolean;
  /**
   * Registry of custom widget components rendered inside ```widget:<name> blocks.
   * Keys are widget names (e.g. "hero"), values are React components.
   * Each registered widget replaces the fenced block with a full-width React component.
   */
  /** Extra extensions to append to the editor */
  extensions?: Extension[];
  widgetComponents?: WidgetRegistry;
  /**
   * Called when an inline button `[Label]{.button ...}` is activated.
   * Receives the action name and a key-value param bag.
   * - route action:    onButtonAction("route", { route: "/tracker" })
   * - named action:    onButtonAction("start-workout", {})
   * - emit action:     onButtonAction("emit", { name: "my-event" })
   */
  onButtonAction?: ButtonAction;
  /** ID of section to scroll into view (matches IDs from lineIdsExtension) */
  scrollToSectionId?: string;
  /** External active section ID supplied by a parent scroll observer */
  activeSectionId?: string | null;
  /** Placeholder text shown when the document is empty */
  placeholder?: string;
  /** Initial open state for Option B docked inspector drawer (Ctrl+Alt+I / Cmd+Alt+I). */
  defaultInspectorDrawerOpen?: boolean;
  /** Drawer layout mode: viewport-fixed docked right or inline beside the editor. */
  inspectorDrawerLayout?: "docked-right" | "inline";
  /** Automatically focus the editor on desktop mount/editable transitions (default: true). */
  autoFocus?: boolean;
}
export interface EditorIdentitySnapshot {
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  sourceRevision: number;
}

type InspectorNavDispatch = (action: { type: "SET_INSPECTOR_DRAWER"; open: boolean }) => void;

interface OptionalNavHandle {
  navState?: { rightDrawerOpen?: boolean; inspectorDrawerOpen?: boolean };
  dispatch?: InspectorNavDispatch;
}

function useOptionalNavCompat(): OptionalNavHandle | null {
  const externalUseOptionalNav = (
    NavContextModule as { useOptionalNav?: () => OptionalNavHandle | null }
  ).useOptionalNav;
  const fallbackCtx = React.useContext(
    NavContextModule.NavContext as unknown as React.Context<OptionalNavHandle | null>,
  );
  return externalUseOptionalNav ? externalUseOptionalNav() : (fallbackCtx ?? null);
}


export const NoteEditor: React.FC<NoteEditorProps> = ({
  noteId,
  noteBlocks,
  sourceRevision = 0,
  onIdentityChange,
  onSaved,
  beforeRun,
  onSaveRequest,
  onCommitChange,
  value,
  onChange,
  onDocUpdate,
  onCursorPositionChange,
  onBlur,
  theme = "vs",
  readonly = false,
  className = "",
  ariaLabel = "Note editor",
  onStartWorkout,
  onCompleteWorkout,
  onBlocksChange,
  onAddToPlan,
  notePersistence: providedNotePersistence,
  onViewCreated,
  mode = "edit",
  lineWrapping: initialLineWrapping = true,
  showLineNumbers: showLineNums = true,
  enablePreview = true,
  showFrontmatter = true,
  enableLinting = true,
  enableOverlay = false,
  commands,
  hideDefaultCommands = false,
  enableInlineRuntime = true,
  extensions: extraExtensions,
  widgetComponents,
  // `onButtonAction` is part of the public contract (inline `[Label]{.button}`
  // activation) but nothing invokes it yet — don't bind until wired.
  activeSectionId: externalActiveSectionId,
  scrollToSectionId,
  results,
  placeholder: placeholderText,
  defaultInspectorDrawerOpen = false,
  inspectorDrawerLayout = "docked-right",
  autoFocus = true,
}) => {
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const deckInteractionUntilRef = useRef(0);
  const navigate = useOptionalNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [dashboardSheetCtx, setDashboardSheetCtx] = useState<SessionActionContext | null>(null);
  const defaultNotePersistenceRef = useRef<INotePersistence | null>(null);
  // Per-instance block-notification dedupe (#885): two editors with identical
  // content (home hero + runway window) must each seed their own blocks — a
  // module-level dedupe swallows the second editor's seed entirely.
  const lastBlocksJsonRef = useRef("");
  // Queue of local doc snapshots emitted via onChange that have not yet echoed
  // back through the controlled `value` prop. Prevents rapid keystrokes (e.g.
  // X{Enter}Y) from racing with React's async render queue and overwriting the
  // live CodeMirror doc + resetting selection to 0.
  const pendingEmittedValuesRef = useRef<string[]>([]);
  // Per-editor completion wiring lives at module scope (below) and rides in
  // baseExtensions: the mode-sync effect applies a full StateEffect.reconfigure
  // after mount, so facet values mounted anywhere else would be dropped (the
  // retired module-global registry existed for the same reason).

  const isDark = theme === "dark" || theme === "vs-dark";
  const { isDebugMode } = useDebugMode();
  const notePersistence = resolveNotePersistence(defaultNotePersistenceRef, providedNotePersistence);
  // Overlay track state
  const [cursorSectionId, setCursorSectionId] = useState<string | null>(null);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorVersion, setCursorVersion] = useState(0);
  const effectiveActiveSectionId = externalActiveSectionId ?? cursorSectionId;
  const overlayState = useOverlayWidthState(sections, effectiveActiveSectionId);

  const [viewInstance, setViewInstance] = useState<EditorView | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 1023px)").matches,
  );
  const [isWheelOpen, setIsWheelOpen] = useState(false);
  const [isMobileTypingMode, setIsMobileTypingMode] = useState(false);

  // Unified Option A popover & Option B drawer inspector state
  const [drawerOpen, setDrawerOpen] = useState<boolean>(defaultInspectorDrawerOpen);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("token");
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null);
  const [lastEditDiff, setLastEditDiff] = useState<EditDiffSummary | null>(null);
  const [notebookScope, setNotebookScope] = useState<NotebookScopeSnapshot>({
    tags: [],
    defaultEquipment: [],
    customMetricTypes: [],
  });

  const liveDocText = viewInstance?.state.doc.toString() ?? value;
  const lastScopeNoteIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (readonly) return;
    let cancelled = false;
    const isInitialOrNoteSwitch = lastScopeNoteIdRef.current !== noteId;
    lastScopeNoteIdRef.current = noteId;
    const run = () => {
      void loadNotebookScopeSnapshot(noteId, liveDocText).then((snap) => {
        if (cancelled) return;
        setNotebookScope((prev) =>
          JSON.stringify(prev) === JSON.stringify(snap) ? prev : snap,
        );
      });
    };
    if (isInitialOrNoteSwitch) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [noteId, liveDocText, readonly]);

  const lineInspection = useMemo<LineInspection>(() => {
    const v = viewInstance ?? viewRef.current;
    if (!v) {
      return {
        contextKind: "markdown",
        section: null,
        focus: null,
        lineNum: 1,
        lineFrom: 0,
        lineTo: 0,
        lineText: "",
        tokens: [],
        lintFixes: [],
      };
    }
    void cursorVersion;
    return extractLineTokens(v.state);
  }, [viewInstance, cursorVersion]);

  const activeInspectorToken = useMemo<InspectorToken | null>(() => {
    if (lineInspection.tokens.length === 0) return null;
    if (selectedTokenId) {
      const exact = lineInspection.tokens.find((t) => t.id === selectedTokenId);
      if (exact) return exact;
    }
    const head = (viewInstance ?? viewRef.current)?.state.selection.main.head ?? 0;
    const atCursor = lineInspection.tokens.find((t) => head >= t.from && head <= t.to);
    return atCursor ?? lineInspection.tokens[0] ?? null;
  }, [lineInspection, selectedTokenId, viewInstance]);

  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const enableOverlayRef = useRef(enableOverlay);
  enableOverlayRef.current = enableOverlay;
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;
  const hasInitializedExtensionsRef = useRef(false);
  const callbacksRef = useRef({
    onChange,
    onCursorPositionChange,
    onBlur,
    onDocUpdate,
    onBlocksChange,
    onIdentityChange,
    onSaveRequest,
    onCommitChange,
  });
  callbacksRef.current = {
    onChange,
    onCursorPositionChange,
    onBlur,
    onDocUpdate,
    onBlocksChange,
    onIdentityChange,
    onSaveRequest,
    onCommitChange,
  };
  const isWheelOpenRef = useRef(isWheelOpen);
  isWheelOpenRef.current = isWheelOpen;
  const notebookScopeRef = useRef<NotebookScopeSnapshot>(notebookScope);
  notebookScopeRef.current = notebookScope;
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  const popoverOpenRef = useRef(popoverOpen);
  popoverOpenRef.current = popoverOpen;
  const inspectorModeRef = useRef(inspectorMode);
  inspectorModeRef.current = inspectorMode;
  const selectedTokenIdRef = useRef(selectedTokenId);
  selectedTokenIdRef.current = selectedTokenId;
  const lineInspectionRef = useRef(lineInspection);
  lineInspectionRef.current = lineInspection;

  const noteNestedCompletionOptions = useMemo<NestedCompletionOptions>(
    () =>
      buildNestedCompletionOptions({
        getNotebookScope: () => notebookScopeRef.current,
        onCreateEffort: async (raw) => {
          await createInlineEffortFromToken(raw);
          viewRef.current?.dispatch({ effects: [catalogueReload.of(null)] });
          setCursorVersion((v) => v + 1);
        },
        onCreateTag: async (slug) => {
          await createInlineTagFromSlug(slug);
          viewRef.current?.dispatch({ effects: [catalogueReload.of(null)] });
          const docText = viewRef.current?.state.doc.toString() ?? "";
          void loadNotebookScopeSnapshot(noteIdRef.current, docText).then((snap) =>
            setNotebookScope(snap),
          );
          setCursorVersion((v) => v + 1);
        },
      }),
    [],
  );

  const openUnifiedInspector = useCallback(
    (options?: {
      mode?: InspectorMode;
      token?: InspectorToken | null;
      tokenIndex?: number;
      anchorRect?: DOMRect | null;
    }) => {
      const v = viewRef.current;
      if (!v || readonlyRef.current) return;
      closeCompletion(v);
      const currentInspection = extractLineTokens(v.state);
      const head = v.state.selection.main.head;
      let chosenToken: InspectorToken | null = options?.token ?? null;
      if (!chosenToken && typeof options?.tokenIndex === "number") {
        chosenToken = currentInspection.tokens[options.tokenIndex] ?? null;
      }
      if (!chosenToken) {
        chosenToken =
          currentInspection.tokens.find((t) => head >= t.from && head <= t.to) ??
          currentInspection.tokens[0] ??
          null;
      }

      const defaultMode: InspectorMode =
        options?.mode ??
        (chosenToken
          ? "token"
          : currentInspection.contextKind === "workout"
            ? "add"
            : currentInspection.contextKind);

      let rect = options?.anchorRect ?? null;
      if (!rect && currentInspection.contextKind === "query" && currentInspection.section) {
        const sec = currentInspection.section;
        try {
          const domAt = v.domAtPos(sec.from);
          const candidateNode = domAt.node instanceof Element ? domAt.node : domAt.node.parentElement;
          const directPreview =
            candidateNode?.closest<HTMLElement>(".cm-query-block-preview, .cm-widget-block-preview") ??
            candidateNode?.querySelector<HTMLElement>(".cm-query-block-preview, .cm-widget-block-preview") ??
            null;
          if (directPreview) {
            const dr = directPreview.getBoundingClientRect();
            if (dr.width > 0 && dr.height > 0) rect = dr;
          }
          if (!rect) {
            const previews = v.dom.querySelectorAll<HTMLElement>(".cm-query-block-preview, .cm-widget-block-preview");
            for (const preview of previews) {
              try {
                const pos = v.posAtDOM(preview);
                if (pos >= sec.from && pos <= sec.to) {
                  const pr = preview.getBoundingClientRect();
                  if (pr.width > 0 && pr.height > 0) {
                    rect = pr;
                    break;
                  }
                }
              } catch {
                // Ignore unmapped preview nodes
              }
            }
          }
        } catch {
          // Fall back cleanly to cursor coords
        }
      }
      if (!rect) {
        try {
          const coords = v.coordsAtPos(chosenToken?.from ?? head);
          if (coords && (coords.right > coords.left || coords.bottom > coords.top)) {
            rect = {
              left: coords.left,
              top: coords.top,
              right: coords.right,
              bottom: coords.bottom,
              width: Math.max(24, coords.right - coords.left),
              height: Math.max(20, coords.bottom - coords.top),
              x: coords.left,
              y: coords.top,
              toJSON: () => ({}),
            } as DOMRect;
          }
        } catch {
          rect = null;
        }
      }

      setInspectorMode(defaultMode);
      setSelectedTokenId(chosenToken?.id ?? null);
      setPopoverAnchorRect(rect);
      setPopoverOpen(!drawerOpenRef.current);
    },
    [],
  );

  const openUnifiedInspectorRef = useRef(openUnifiedInspector);
  openUnifiedInspectorRef.current = openUnifiedInspector;

  const getInspectorSnapshotRef = useRef<() => EditorInspectorSnapshot>(() => ({
    drawerOpen: drawerOpenRef.current,
    popoverOpen: popoverOpenRef.current,
    mode: inspectorModeRef.current,
    contextKind: lineInspectionRef.current.contextKind,
    lineNum: lineInspectionRef.current.lineNum,
    selectedTokenId: selectedTokenIdRef.current,
    tokens: lineInspectionRef.current.tokens.map((t) => ({
      id: t.id,
      kind: t.kind,
      raw: t.raw,
      from: t.from,
      to: t.to,
    })),
    lintFixes: lineInspectionRef.current.lintFixes.map((lf) => ({
      id: lf.id,
      raw: lf.raw,
      fixes: lf.fixes,
    })),
  }));

  useEffect(() => {
    if (readonly || isMobileViewport) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const wrapper = editorWrapperRef.current;
      const activeEl = document.activeElement;
      if (!wrapper || !activeEl || !wrapper.contains(activeEl)) {
        return;
      }
      const isModAltI =
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        !event.shiftKey &&
        (event.key.toLowerCase() === "i" || event.code === "KeyI");
      const isAltDot =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "." || event.code === "Period");

      if (isModAltI) {
        event.preventDefault();
        event.stopPropagation();
        setDrawerOpen((prev) => {
          const next = !prev;
          if (next) {
            if (viewRef.current) closeCompletion(viewRef.current);
            setPopoverOpen(false);
          }
          return next;
        });
      } else if (isAltDot) {
        event.preventDefault();
        event.stopPropagation();
        openUnifiedInspectorRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [readonly, isMobileViewport]);

  const nav = useOptionalNavCompat();
  const navDispatch = nav?.dispatch;
  const rightDrawerOpen = Boolean(nav?.navState?.rightDrawerOpen);
  const effectiveDrawerOpen = !readonly && !isMobileViewport && drawerOpen;
  const prevSyncedInspectorRef = useRef(false);

  useEffect(() => {
    if (!navDispatch) return;
    if (effectiveDrawerOpen !== prevSyncedInspectorRef.current) {
      prevSyncedInspectorRef.current = effectiveDrawerOpen;
      navDispatch({ type: "SET_INSPECTOR_DRAWER", open: effectiveDrawerOpen });
    }
  }, [navDispatch, effectiveDrawerOpen]);

  useEffect(() => {
    return () => {
      if (prevSyncedInspectorRef.current) {
        prevSyncedInspectorRef.current = false;
        navDispatch?.({ type: "SET_INSPECTOR_DRAWER", open: false });
      }
    };
  }, [navDispatch]);

  useEffect(() => {
    if (rightDrawerOpen) {
      setDrawerOpen(false);
    }
  }, [rightDrawerOpen]);

  // Re-measure CodeMirror geometry and inline panel bounds when the drawer opens or closes
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      viewRef.current?.requestMeasure();
      setCursorVersion((v) => v + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 1023px)");
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobileViewport(e.matches);
      if (!e.matches) {
        setIsWheelOpen(false);
        setIsMobileTypingMode(false);
      } else {
        setPopoverOpen(false);
        setDrawerOpen(false);
      }
    };
    setIsMobileViewport(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);
  // Full-screen timer block: when set, the FullscreenTimer overlay is shown.
  const [fullscreenTimerBlock, setFullscreenTimerBlock] = useState<ScriptBlock | null>(null);
  // Pinned run session id for the open overlay — unlocks durable post-run
  // actual corrections (FullscreenTimer queue → captureMetricCorrection).
  const [fullscreenResultId, setFullscreenResultId] = useState<string | null>(null);


  // Whether the fullscreen timer should auto-start on mount
  const [autoStartFullscreen, setAutoStartFullscreen] = useState(false);

  const capturedRunRef = useRef<CapturedRun | null>(null);
  const startingRunRef = useRef(false);
  const savedRevisionRef = useRef(sourceRevision ?? 0);
  useEffect(() => { savedRevisionRef.current = sourceRevision ?? 0; }, [sourceRevision]);
  const [runError, setRunError] = useState<string | null>(null);
  const finishedRunRef = useRef<string | null>(null);
  const handleRun = useCallback(async (block: ScriptBlock, autoStart = false) => {
    const view = viewRef.current;
    if (!view || startingRunRef.current) return;
    startingRunRef.current = true;
    setRunError(null);
    try {
      const committedRevision = await beforeRun?.();
      if (typeof committedRevision === 'number') savedRevisionRef.current = committedRevision;
      const identity = view.state.field(sectionField);
      const runNoteId = noteId ?? uuidv7();
      const captured = await captureRun({
        noteId: runNoteId,
        rawContent: identity.rawContent,
        blocks: identity.noteBlocks,
        expectedSourceRevision: savedRevisionRef.current,
        ...(!noteId ? { metadata: { title: 'Playground workout' }, noteType: 'playground' as const } : {}),
      }, block, uuidv7(), noteId ? undefined : 'playground', notePersistence, { deferPersist: true });
      capturedRunRef.current = captured;
      finishedRunRef.current = null;
      savedRevisionRef.current = captured.note.sourceRevision;
      view.dispatch({ effects: sectionSaved.of({ blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision }) });
      onSaved?.({ rawContent: captured.note.rawContent, blocks: captured.note.blocks, sourceRevision: captured.note.sourceRevision });
      setAutoStartFullscreen(autoStart);
      setFullscreenTimerBlock(captured.block);
      setFullscreenResultId(captured.session.id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      startingRunRef.current = false;
    }
  }, [noteId, notePersistence, onSaved, beforeRun]);

  // Close the full-screen timer.
  const handleTimerClose = useCallback(() => {
    setFullscreenTimerBlock(null);
    setFullscreenResultId(null);
    setAutoStartFullscreen(false);
  }, []);

  // Intercept selection from Chromecast to start the inline runtime with auto-start.
  const handleCastSelectBlock = useCallback((block: ScriptBlock) => {
    if (enableInlineRuntime) {
      void handleRun(block, true);
    }
  }, [enableInlineRuntime, handleRun]);

  useEffect(() => {
    return registerActiveEditorBridge({
      noteId,
      readonly: Boolean(readonly),
      sourceRevision,
      getValue: () => viewRef.current?.state.doc.toString() ?? value,
      getView: () => viewRef.current,
      getBlocks: () => {
        const view = viewRef.current;
        if (!view) return [];
        const sectionState: SectionState = view.state.field(sectionField);
        return sectionState.sections
          .filter((s) => s.type === "time" || s.type === "log")
          .map((s) => sectionToScriptBlock(s, view.state))
          .filter((b): b is ScriptBlock => b !== null);
      },
      applyEdit: async (nextDoc: string, commit = false) => {
        if (readonly) {
          throw new Error("Editor is in read-only mode. Clone this Note before editing.");
        }
        const view = viewRef.current;
        if (!view) {
          onChange(nextDoc);
          if (commit) await (onSaveRequest ?? onCommitChange)?.();
          return;
        }
        const currentLen = view.state.doc.length;
        view.dispatch({
          changes: { from: 0, to: currentLen, insert: nextDoc },
        });
        onChange(nextDoc);
        if (commit) {
          await (onSaveRequest ?? onCommitChange)?.();
        }
      },
      undoEdit: () => {
        const view = viewRef.current;
        if (!view || readonly) return false;
        const ok = undo(view);
        if (ok) {
          onChange(view.state.doc.toString());
        }
        return ok;
      },
      startLiveWorkout: async (blockId?: string, autoStart = true) => {
        const view = viewRef.current;
        if (!view) return { started: false, error: "Editor view is not mounted." };
        const sectionState: SectionState = view.state.field(sectionField);
        const blocks = sectionState.sections
          .filter((s) => s.type === "time" || s.type === "log")
          .map((s) => sectionToScriptBlock(s, view.state))
          .filter((b): b is ScriptBlock => b !== null);
        const target = blockId ? blocks.find((b) => b.id === blockId) : blocks[0];
        if (!target) {
          return {
            started: false,
            error: blockId
              ? `Workout block '${blockId}' not found in editor.`
              : "No runnable ```time workout block found in editor.",
          };
        }
        await handleRun(target, autoStart);
        return { started: true, blockId: target.id };
      },
      getInspectorState: () => getInspectorSnapshotRef.current(),
      setInspectorDrawer: (open: boolean) => {
        setDrawerOpen(open);
        if (open) setPopoverOpen(false);
      },
      openTokenInspector: (options?: { mode?: string; tokenIndex?: number }) => {
        openUnifiedInspectorRef.current({
          mode: options?.mode as InspectorMode | undefined,
          tokenIndex: options?.tokenIndex,
        });
      },
      closeTokenInspector: () => {
        setPopoverOpen(false);
      },
    });
  }, [noteId, readonly, sourceRevision, value, onChange, onSaveRequest, onCommitChange, handleRun]);

  // Keep the report until both the pinned completion and host save succeed.
  const lastReportRef = useRef<{
    results: ScriptBlock["results"];
    resultId: string;
    runBlock?: Pick<ScriptBlock, "id" | "contentId">;
  } | null>(null);

  // Position the result table by occurrence ID, never by matching workout text.
  const handleCompleteWorkout = useCallback(
    (blockId: string, results: ScriptBlock["results"]) => {
      const pending = lastReportRef.current;
      const isRetry = pending !== null && pending.results === results;
      const capture = capturedRunRef.current;
      if (!capture || !results) return Promise.reject(new Error('The saved run pin is unavailable.'));
      const resultId = capture.session.id;
      if (finishedRunRef.current === resultId) return Promise.resolve();
      const runBlock = { id: capture.block.id, contentId: capture.session.blockContentId };
      if (!isRetry && results && viewRef.current) {
        const view = viewRef.current;
        const insert = sessionQueryInsert(view.state, blockId, resultId);
        if (insert) {
          // #945: the inserted table IS the results moment — reveal it inline,
          // no overlay. Positions in scroll effects refer to the post-change doc.
          const blockStart = insert.from + insert.insert.indexOf("```");
          view.dispatch({
            changes: insert,
            effects: [EditorView.scrollIntoView(blockStart, { y: "start", yMargin: 96 })],
          });
          onChange?.(view.state.doc.toString());
        }
      }
      // Memo BEFORE the call — a synchronous host throw stays retryable.
      if (!isRetry) lastReportRef.current = { results, resultId, runBlock };
      let save: void | Promise<unknown>;
      try {
        save = createResultRecorder(notePersistence).record({ resultId, noteId: capture.session.noteId, blockId: capture.session.blockId, data: results, createdAt: results.endTime }).then(() => onCompleteWorkout?.(blockId, results, resultId, runBlock));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      void Promise.resolve(save).then(
        () => {
          if (lastReportRef.current?.results === results) lastReportRef.current = null;
          finishedRunRef.current = resultId;
        },
        () => {}, // failure keeps the memo — the retry must reuse id + insert
      );
      return save;
    },
    [onChange, onCompleteWorkout, notePersistence],
  );

  // Fetch workout results for all workout (time/log) sections and push them into the editor
  // via the results StateEffect so the inline results bar is visible.

  // Build effective command list: use explicit commands if provided, otherwise
  // synthesize from legacy onStartWorkout / onAddToPlan for backward compat.
  // When enableInlineRuntime is true the "Run" command uses handleRun
  // instead of routing via onStartWorkout.
  const effectiveCommands = useMemo<ScriptCommand[]>(() => {
    if (hideDefaultCommands) return [];
    if (commands && commands.length > 0) return commands;
    const synthesized: ScriptCommand[] = [];
    if (enableInlineRuntime) {
      // Full-screen run: open FullscreenTimer panel
      synthesized.push({
        id: "run",
        label: "Run",
        icon: <Play className="h-3 w-3 fill-current" />,
        primary: true,
        onClick: handleRun,
      });
    } else if (onStartWorkout) {
      synthesized.push({
        id: "run",
        label: "Run",
        icon: <Play className="h-3 w-3 fill-current" />,
        primary: true,
        onClick: onStartWorkout,
      });
    }

    // Secondary group: Playground (first), Results, Plan
    synthesized.push({
      id: "playground",
      label: "Playground",
      icon: <ExternalLink className="h-3 w-3" />,
      splitIcon: <Copy className="h-3 w-3" />,
      splitSuccessIcon: <Check className="h-3 w-3" />,
      onClick: (block) => {
        void buildPlaygroundUrl(block.content).then((url) => {
          const tab = window.open(url, "wodwiki-playground");
          if (tab) tab.focus();
        });
      },
      onSplitClick: async (block) => {
        // Copy shares the home-page version (/load?z=) — the workout lands
        // in the home hero editor, not a spawned playground note.
        const url = await buildHomeShareUrl(block.content);
        await navigator.clipboard.writeText(url);
      },
    });

    if (onAddToPlan) {
      synthesized.push({
        id: "plan",
        label: "Plan",
        icon: <Plus className="h-3 w-3" />,
        onClick: onAddToPlan,
      });
    }

    return synthesized;
  }, [commands, onStartWorkout, onAddToPlan, enableInlineRuntime, hideDefaultCommands, handleRun]);

  // Mixed language: Markdown + embedded dialect fences (time/log with sport,
  // query/wql, wod/whiteboard aliases) via the shared resolver.
  const languages = useMemo(() => {
    return markdown({
      codeLanguages: resolveCodeLanguage,
    });
  }, []);

  const effectiveBlocks = useMemo(() => {
    const rev = Math.max(1, sourceRevision);
    const registeredWidgets = widgetComponents ? [...widgetComponents.keys()] : KNOWN_SECTION_WIDGETS;
    if (noteBlocks && Object.keys(noteBlocks).length > 0) {
      try {
        validateNoteBlocks(value, noteBlocks, rev, { registeredWidgets });
        return noteBlocks;
      } catch {
        return reconcileNoteBlocks(value, { sourceRevision: rev, blocks: noteBlocks, registeredWidgets });
      }
    }
    return reconcileNoteBlocks(value, { sourceRevision: rev, registeredWidgets });
  }, [value, noteBlocks, sourceRevision, widgetComponents]);

  const baseExtensions = useMemo(
    () => [
      // Core editing
      ...(showLineNums ? [lineNumbers(), highlightActiveLineGutter()] : []),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      ...(initialLineWrapping ? [EditorView.lineWrapping] : []),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      // bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),

      // Keybindings
      wodCompletionKeymap,
      wodIndentKeymap,
      keymap.of([
        ...closeBracketsKeymap,
        ...markdownKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          run: () => {
            // Always handled: prevents the browser's native Save-Page dialog.
            void callbacksRef.current.onSaveRequest?.();
            return true;
          },
        },
        {
          key: "Alt-.",
          run: () => {
            if (readonlyRef.current) return false;
            openUnifiedInspectorRef.current();
            return true;
          },
        },
        {
          key: "Mod-Alt-i",
          run: () => {
            if (readonlyRef.current) return false;
            setDrawerOpen((prev) => {
              const next = !prev;
              if (next) {
                if (viewRef.current) closeCompletion(viewRef.current);
                setPopoverOpen(false);
              }
              return next;
            });
            return true;
          },
        },
      ]),

      // Existing extensions
      smartIncrement,

      // ---- Note Editor Extensions ----

      // Section tracking (required by all other unified extensions)
      sectionField,
      sectionIdentity.of({ blocks: effectiveBlocks, sourceRevision: Math.max(1, sourceRevision), rawContent: value }),
      registeredSectionWidgets.of(widgetComponents ? [...widgetComponents.keys()] : KNOWN_SECTION_WIDGETS),
      sectionIdentityHistory,
      frontmatterVisibility.of(showFrontmatter),
      frontmatterDebugMode.of(isDebugMode),
      ...(enablePreview || !showFrontmatter ? [frontmatterPreview] : []),

      // Block-level preview decorations
      ...(enablePreview ? [
        editorFocusTracker,
        previewDecorations,
        embedPreviewDecorations,
        createAttachmentUrlExtension(noteId),
        createFrontmatterSuggestions(),
        createFrontmatterReferenceProvider(),
        markdownTablePreview,
        markdownSyntaxHiding(),
        linkPreview,
      ] : []),

      // Whiteboard Script linting (no separate lintGutter — unified gutter handles it)
      ...(enableLinting ? [wodLinter] : []),

      // Autocomplete (fence-tag + embed completions), the shared tooltip
      // theme, body portal, and fence wrapping
      tooltips({ parent: document.body }),
      wodAutocompletion,
      autocompleteTooltipTheme,
      wodEditorKeymap,
      wodAutoWrap,
      // Per-editor completion sources (facet values must ride in
      // baseExtensions to survive the mode-sync reconfigure).
      customCompletionSources.of(frontmatterCompletionSource),
      customCompletionSources.of(markdownProseCompletionSource),
      nestedCompletionOptions.of(noteNestedCompletionOptions),

      // Overlay panel for Whiteboard Script blocks
      ...(enableOverlay ? [wodOverlayPanel] : []),

      // Section geometry measurement (for overlay track)
      sectionGeometry,

      // Ctrl+Click & Link Pill navigation (SPA-friendly for internal paths)
      affiliateTagFacet.of(ASSOCIATE_TAG),
      navigationFacet.of((url) => {
        if (/^(https?:|mailto:|tel:)/i.test(url)) {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        if (url.startsWith("/") && typeof window !== "undefined") {
          window.history.pushState({}, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
          return;
        }
        if (typeof window !== "undefined") {
          window.location.assign(url);
        }
      }),
      linkOpen,

      // Inline metric hover tooltip

      // Cursor focus: token-level metric highlighting, closing-fence widget, and cursor state
      cursorFocusExtension,

      // Unified gutter: lint diagnostics + runtime highlights in one column
      ...gutterUnified,

      // Line IDs for external navigation (IntersectionObserver, scroll)
      lineIdsExtension,


      // Full-row widget block replacements (```widget:<name>``` sections)
      ...(widgetComponents && widgetComponents.size > 0
        ? [widgetBlockPreview(widgetComponents)]
        : []),

      // Inline ```query blocks — live WQL results (#801, widget suffixes #899).
      // The executor is the IndexedDB-wired QueryService singleton and
      // onResultSaved re-runs :session{result:…} blocks when a workout result
      // lands — without either, every query block spins "Loading…" forever
      // (the UI package is store-free; the app owns persistence).
      queryBlockPreview({
        executor: queryService,
        onResultSaved,
        readOnly: readonly,
        onCaptureRpe: readonly
          ? undefined
          : async (rId, rpe) => {
              await captureSessionRpe(rId, rpe);
            },
        onEditMetric: readonly
          ? undefined
          : async (rId, payload) => {
              const outcome = await captureMetricCorrection({
                resultId: rId,
                occurrence: payload.occurrence,
                metric: {
                  type: payload.metric.type as Parameters<typeof captureMetricCorrection>[0]['metric']['type'],
                  value: payload.metric.value,
                  image: payload.metric.image,
                },
              });
              if (outcome === 'not-found') {
                throw new Error('Result segment not found in storage.');
              }
            },
        onOpenResults: (ctx) => {
          const dest = sessionDetailPath(ctx.resultId);
          if (navigateRef.current) {
            void navigateRef.current(dest);
          } else if (typeof window !== 'undefined') {
            window.location.assign(dest);
          }
        },
        onAddToDashboard: (ctx) => {
          setDashboardSheetCtx(ctx);
        },
        noteHref: (item) => {
          const isBlock = 'blockContentId' in item || 'dataType' in item;
          const entry = isBlock
            ? blockToEntry(item as unknown as Parameters<typeof blockToEntry>[0])
            : toEntry(item as unknown as Parameters<typeof toEntry>[0]);
          return entryOpenHref(entry);
        },
      }),

      // File drop handler
      createFileDropHandler(noteId, notePersistence),

      // Focus / blur handlers — sync mobile wheel deck, close stale completions, and host blur callback
      EditorView.domEventHandlers({
        focus: (_event, view) => {
          if (
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(max-width: 1023px)").matches &&
            !readonly
          ) {
            const sec = activeCursorSection(view.state);
            const isStructured =
              sec?.type === "time" || sec?.type === "log" || sec?.type === "query";
            view.contentDOM.setAttribute("inputmode", isStructured ? "none" : "text");
            setIsWheelOpen(true);
            setIsMobileTypingMode(!isStructured);
          }
          return false;
        },
        blur: (event, view) => {
          const related = event.relatedTarget as HTMLElement | null;
          if (!related || !related.closest(".cm-tooltip")) {
            closeCompletion(view);
          }
          const insideEditor = Boolean(related && editorRef.current?.contains(related));
          const insideDeck = Boolean(
            related?.closest('[data-mobile-editor-deck="true"]') ||
              (!related && Date.now() < deckInteractionUntilRef.current),
          );
          if (!insideEditor && !insideDeck) {
            setIsWheelOpen(false);
            setIsMobileTypingMode(false);
          }
          callbacksRef.current.onBlur?.();
          return false;
        },
      }),

      // Update listener
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const identity = update.state.field(sectionField);
          callbacksRef.current.onIdentityChange?.({ rawContent: identity.rawContent, blocks: identity.noteBlocks, sourceRevision: identity.sourceRevision });
          const isExternalValueSync = update.transactions.every(
            (t) => t.annotation(externalValueSyncAnnotation) === true,
          );
          if (!isExternalValueSync) {
            pendingEmittedValuesRef.current.push(identity.rawContent);
            callbacksRef.current.onChange(identity.rawContent);
          }
          callbacksRef.current.onDocUpdate?.(update);
          notifyBlockChanges(update.state, callbacksRef.current.onBlocksChange, lastBlocksJsonRef);
          if (!isExternalValueSync) {
            // Typing-like transactions stay coalesced; everything else (widget
            // commits, query-block inserts, undo) is a deliberate commit — save now.
            const typed = update.transactions.some(t =>
              (t.isUserEvent("input") && !t.isUserEvent("input.wheel") && !t.isUserEvent("input.format"))
              || t.isUserEvent("delete")
              || t.isUserEvent("paste")
              || t.isUserEvent("drop"));
            if (!typed) {
              void Promise.resolve(callbacksRef.current.onCommitChange?.()).catch(() => {});
            }
          }
        }
        const prevCompStatus = completionStatus(update.startState);
        const nextCompStatus = completionStatus(update.state);
        const compChanged =
          prevCompStatus !== nextCompStatus ||
          selectedCompletionIndex(update.startState) !== selectedCompletionIndex(update.state);
        if (prevCompStatus !== "active" && nextCompStatus === "active") {
          setPopoverOpen(false);
        }
        if (!update.selectionSet && !update.docChanged && compChanged) {
          setCursorVersion((version) => version + 1);
        }
        if (update.selectionSet || update.docChanged) {
          setCursorVersion((version) => version + 1);
          if (update.transactions.some((transaction) => transaction.isUserEvent("delete.backward")) &&
              completionStatus(update.startState) !== null && completionStatus(update.state) === null &&
              frontmatterValueContext(update.state, update.state.selection.main.head)?.value === "") {
            queueMicrotask(() => {
              if (update.view.state === update.state) startCompletion(update.view);
            });
          } else if (
            update.docChanged &&
            update.transactions.some((transaction) => transaction.isUserEvent("input.type")) &&
            completionStatus(update.state) === null
          ) {
            const { head: triggerHead } = update.state.selection.main;
            const triggerLine = update.state.doc.lineAt(triggerHead);
            const before = triggerLine.text.slice(0, triggerHead - triggerLine.from);
            const curSec = activeCursorSection(update.state);
            const inWorkout = curSec?.type === "time" || curSec?.type === "log";
            const triggersWikiOrCue = /(\[\[|\[:)$/.test(before);
            const triggersTag =
              /(?:^|\s)#$/.test(before) &&
              (inWorkout || !/^\s*#$/.test(before));
            if (triggersWikiOrCue || triggersTag) {
              queueMicrotask(() => {
                if (update.view.state === update.state) startCompletion(update.view);
              });
            }
          }
          const { head } = update.state.selection.main;
          const line = update.state.doc.lineAt(head);
          callbacksRef.current.onCursorPositionChange?.(line.number, head - line.from + 1);

          // Update overlay track state
          const cursorSec = activeCursorSection(update.state);
          setCursorSectionId(cursorSec?.id ?? null);
          setCursorLine(line.number);
          if (enableOverlayRef.current) {
            const { sections: secs } = update.state.field(sectionField);
            setSections(secs);
          }

          if (
            update.selectionSet &&
            isMobileViewportRef.current &&
            !readonlyRef.current &&
            update.transactions.some((t) => t.isUserEvent("select.pointer"))
          ) {
            const prevSec = activeCursorSection(update.startState);
            const prevStructured =
              prevSec?.type === "time" || prevSec?.type === "log" || prevSec?.type === "query";
            const nextStructured =
              cursorSec?.type === "time" || cursorSec?.type === "log" || cursorSec?.type === "query";
            if (prevStructured !== nextStructured) {
              update.view.contentDOM.setAttribute("inputmode", nextStructured ? "none" : "text");
              setIsMobileTypingMode(!nextStructured);
            }
          }
        }
      }),

      // Read-only state
      EditorState.readOnly.of(readonly),
      EditorView.editable.of(!readonly),
      ...(placeholderText ? [placeholder(placeholderText)] : []),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial doc/identity seed; ongoing callbacks ride in callbacksRef
    [
      readonly,
      showLineNums,
      initialLineWrapping,
      enablePreview,
      showFrontmatter,
      isDebugMode,
      enableLinting,
      enableOverlay,
      noteId,
      notePersistence,
      widgetComponents,
      placeholderText,
      ariaLabel,
    ]
  );

  // Create editor on mount
  useEffect(() => {
    const mountNode = editorRef.current;
    if (!mountNode) return;

    let state: EditorState;
    try {
      state = EditorState.create({
        doc: value,
        extensions: [
          ...baseExtensions,
          themeCompartment.of(editorTheme(isDarkRef.current)),
          languageCompartment.of(languages),
          modeCompartment.of([]),
          inputModeCompartment.of([
            EditorView.contentAttributes.of({
              inputmode: isMobileViewport && !isMobileTypingMode ? "none" : "text",
            }),
            mobileDockedCompletionFacet.of(
              isMobileViewport && isWheelOpen && isMobileTypingMode && !readonly,
            ),
          ]),
          ...(extraExtensions ?? []),
        ],
      });
    } catch (err) {
      console.error('NoteEditor: Failed to initialize EditorState, recovering with safe fallback', err);
      state = EditorState.create({
        doc: value,
        extensions: [
          themeCompartment.of(editorTheme(isDark)),
          languageCompartment.of(languages),
        ],
      });
    }

    const view = new EditorView({
      state,
      parent: mountNode,
    });

    const viewport = window.visualViewport;
    let keyboardScrollFrame = 0;
    const revealKeyboardCaret = () => {
      cancelAnimationFrame(keyboardScrollFrame);
      keyboardScrollFrame = requestAnimationFrame(() => {
        if (isWheelOpenRef.current) return;
        const scaleOk = !viewport || viewport.scale <= 1.05;
        const resized = !viewport || viewport.height < window.innerHeight;
        if (view.hasFocus && scaleOk && resized) {
          if (isMobileViewportRef.current) {
            revealMobileEditRow(view, { forceCenter: true });
          } else {
            view.dispatch({
              effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest", yMargin: 24 }),
            });
          }
        }
      });
    };
    viewport?.addEventListener("resize", revealKeyboardCaret);
    view.contentDOM.addEventListener("focus", revealKeyboardCaret);

    viewRef.current = view;
    setViewInstance(view);
    // Expose view for test automation to directly manipulate content
    (mountNode as unknown as { __codemirrorView?: EditorView }).__codemirrorView = view;
    onViewCreated?.(view);

    // Seed overlay state from initial editor state so panels render
    // immediately without requiring a cursor move or click.
    const { sections: initialSections } = view.state.field(sectionField);
    setSections(initialSections);
    const initialLine = view.state.doc.lineAt(
      view.state.selection.main.head
    ).number;
    setCursorLine(initialLine);
    const initialSection = activeCursorSection(view.state);
    setCursorSectionId(initialSection?.id ?? null);

    // Seed block list so onBlocksChange fires on initial mount (not just on edits)
    const initialIdentity = view.state.field(sectionField);
    onIdentityChange?.({ rawContent: initialIdentity.rawContent, blocks: initialIdentity.noteBlocks, sourceRevision: initialIdentity.sourceRevision });
    notifyBlockChanges(view.state, onBlocksChange, lastBlocksJsonRef);

    return () => {
      cancelAnimationFrame(keyboardScrollFrame);
      viewport?.removeEventListener("resize", revealKeyboardCaret);
      view.contentDOM.removeEventListener("focus", revealKeyboardCaret);
      delete (mountNode as unknown as { __codemirrorView?: EditorView }).__codemirrorView;
      hasInitializedExtensionsRef.current = false;
      setViewInstance(null);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only contract; value/theme/extension syncs live in dedicated effects below
  }, []); // Mount only

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const identity = view.state.field(sectionField);
    const pending = pendingEmittedValuesRef.current;
    if (value === identity.rawContent) {
      pending.length = 0;
      if (noteBlocks && sourceRevision !== identity.sourceRevision) {
        view.dispatch({ effects: sectionSaved.of({ blocks: noteBlocks, sourceRevision: Math.max(1, sourceRevision) }) });
      }
      return;
    }
    const echoIdx = pending.indexOf(value);
    if (echoIdx !== -1) {
      pending.splice(0, echoIdx + 1);
      return;
    }
    pending.length = 0;
    const rev = Math.max(1, sourceRevision);
    const expected = noteBlocks ? reconcileNoteBlocks(value, { sourceRevision: rev, blocks: noteBlocks, registeredWidgets: widgetComponents ? [...widgetComponents.keys()] : KNOWN_SECTION_WIDGETS }) : undefined;
    const validRestore = expected && noteBlocks && Object.keys(expected).length === Object.keys(noteBlocks).length
      && Object.entries(noteBlocks).every(([id, b]) => {
        const r = expected[id];
        return r && r.from === b.from && r.to === b.to && r.kind === b.kind && r.dialect === b.dialect && r.sport === b.sport;
      });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalValueSyncAnnotation.of(true),
      ...(validRestore ? { effects: sectionRestore.of({ rawContent: value, blocks: noteBlocks, sourceRevision: rev }) } : {}),
    });
  }, [value, noteBlocks, sourceRevision]);

  // Sync theme
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeCompartment.reconfigure(editorTheme(isDark)),
      });
    }
  }, [isDark]);

  const isMobileViewportRef = useRef(isMobileViewport);
  isMobileViewportRef.current = isMobileViewport;
  const isMobileTypingModeRef = useRef(isMobileTypingMode);
  isMobileTypingModeRef.current = isMobileTypingMode;

  // Dismiss the mobile thumb deck on outside pointer taps even when focus had
  // shifted temporarily into a deck input or scrubber control.
  useEffect(() => {
    if (!isMobileViewport || !isWheelOpen || readonly || typeof document === "undefined") return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editorRef.current?.contains(target)) return;
      if (target.closest('[data-mobile-editor-deck="true"], .cm-tooltip')) return;
      setIsWheelOpen(false);
      setIsMobileTypingMode(false);
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }, [isMobileViewport, isWheelOpen, readonly]);

  // Sync mode and extensions
  useEffect(() => {
    if (!viewRef.current) return;
    if (!hasInitializedExtensionsRef.current) {
      hasInitializedExtensionsRef.current = true;
      return;
    }
    const modeExtensions: Extension = mode === "track" ? [] : [];
    viewRef.current.dispatch({
      effects: [
        StateEffect.reconfigure.of([
          ...baseExtensions,
          themeCompartment.of(editorTheme(isDarkRef.current)),
          languageCompartment.of(languages),
          modeCompartment.of(modeExtensions),
          inputModeCompartment.of([
            EditorView.contentAttributes.of({
              inputmode:
                isMobileViewportRef.current && !isMobileTypingModeRef.current
                  ? "none"
                  : "text",
            }),
            mobileDockedCompletionFacet.of(
              isMobileViewportRef.current &&
                isWheelOpenRef.current &&
                isMobileTypingModeRef.current &&
                !readonlyRef.current,
            ),
          ]),
          ...(extraExtensions ?? []),
        ]),
      ],
    });
  }, [baseExtensions, extraExtensions, mode, languages]);

  // Sync mobile inputmode attribute and docked completion suppression via
  // their dedicated compartment so toggling [Type]/[Deck] never reconfigures
  // the whole editor or clobbers selection!
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: inputModeCompartment.reconfigure([
          EditorView.contentAttributes.of({
            inputmode: isMobileViewport && !isMobileTypingMode ? "none" : "text",
          }),
          mobileDockedCompletionFacet.of(
            isMobileViewport && isWheelOpen && isMobileTypingMode && !readonly,
          ),
        ]),
      });
    }
  }, [isMobileViewport, isWheelOpen, isMobileTypingMode, readonly]);

  // Focus on open / readonly->editable transition on desktop (>=1024px) only.
  // Mobile (<1024px) opens cleanly blurred so notes read as pure documents
  // without auto-popping the OS keyboard or wheel deck until a line is tapped.
  useEffect(() => {
    if (!autoFocus) return;
    const isMobile =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1023px)").matches;
    if (!readonly && !isMobile) viewRef.current?.focus();
  }, [readonly, autoFocus]);

  // Handle external scroll requests
  useEffect(() => {
    if (scrollToSectionId && viewRef.current) {
      const view = viewRef.current;
      const content = view.state.doc.toString();
      const lines = content.split("\n");
      
      let lineIdx: number;

      // Matches logic in line-ids.ts and extractPageIndex (App.tsx).
      // Workout line IDs end with `-line-<1-based line number>` (the prefix
      // mirrors the fence tag: time-line-* / log-line-*).
      const lineMatch = scrollToSectionId.match(/-line-(\d+)$/);
      if (lineMatch) {
        const lineNum = parseInt(lineMatch[1], 10);
        lineIdx = lineNum - 1;
      } else {
        lineIdx = lines.findIndex((line) => {
          const match = line.match(/^(#{1,6})\s+(.*)$/);
          if (match) {
            let label = match[2].trim();
            const timeMatch = label.match(/(\d{1,2}:\d{2})/);
            if (timeMatch) {
              const timestamp = timeMatch[1];
              label = label.replace(timestamp, "").replace(/\s+/g, " ").trim();
              if (!label) label = timestamp;
            }
            const headerId = label.toLowerCase().replace(/[^\w]+/g, "-");
            return headerId === scrollToSectionId;
          }
          return false;
        });
      }

      if (lineIdx >= 0 && lineIdx < lines.length) {
        const pos = view.state.doc.line(lineIdx + 1).from;
        view.dispatch({
          selection: { anchor: pos, head: pos },
          effects: [EditorView.scrollIntoView(pos, { y: "start", yMargin: 20 })],
        });
      }
    }
  }, [scrollToSectionId]);

  // Slot renderer — routes to companion components by section type
  const renderSlot = (props: OverlaySlotProps) => {
    if (!showFrontmatter && props.sectionType === "frontmatter") return null;
    if (props.sectionType === "time" || props.sectionType === "log") {
      return (
        <WhiteboardCompanion
          noteId={noteId}
          sectionId={props.sectionId}
          view={props.view}
          isActive={props.isActive}
          widthPercent={props.widthPercent}
          cursorLine={cursorLine}
          docVersion={props.docVersion}
          commands={effectiveCommands}
          extendedResults={results}
          hoverLine={props.hoverLine}
          stickyTopOffset={props.stickyTopOffset}
          isPanelHovered={props.isPanelHovered}
          lineDocY={props.lineDocY}
          rect={props.rect}
        />
      );
    }

    if (props.sectionType === "frontmatter" || props.sectionType === "embed") {
      const { sections } = props.view.state.field(sectionField);
      const section = sections.find(s => s.id === props.sectionId);
      return (
        <FrontmatterCompanion
          sectionId={props.sectionId}
          section={section}
          view={props.view}
          isActive={props.isActive}
          widthPercent={props.widthPercent}
          docVersion={props.docVersion}
        />
      );
    }
    if (props.sectionType === "widget" && props.widgetName) {
      return (
        <WidgetCompanion
          sectionId={props.sectionId}
          widgetName={props.widgetName}
          view={props.view}
          registry={widgetComponents ?? new Map()}
          docVersion={props.docVersion}
        />
      );
    }
    // Default placeholder for other section types
    return (
      <div className="h-full w-full bg-popover/80 backdrop-blur-sm border-l border-border rounded-l-md p-2 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">{props.sectionType}</div>
      </div>
    );
  };

  const handleStepInspectorToken = useCallback(
    (delta: -1 | 1) => {
      const tokens = lineInspection.tokens;
      if (tokens.length === 0) return;
      const currentId = activeInspectorToken?.id;
      const idx = tokens.findIndex((t) => t.id === currentId);
      const baseIdx = idx >= 0 ? idx : 0;
      const nextIdx = (baseIdx + delta + tokens.length) % tokens.length;
      const nextTok = tokens[nextIdx];
      if (!nextTok) return;
      setSelectedTokenId(nextTok.id);
      const v = viewRef.current;
      if (v) {
        v.dispatch({
          selection: { anchor: nextTok.from, head: nextTok.to },
          scrollIntoView: true,
        });
      }
    },
    [lineInspection.tokens, activeInspectorToken],
  );

  const handleInspectorMutate = useCallback((diff: EditDiffSummary | null) => {
    if (diff) setLastEditDiff(diff);
    setCursorVersion((v) => v + 1);
  }, []);

  const activeView = viewInstance ?? viewRef.current;
  const showDesktopInspector = !isMobileViewport && !readonly;
  const isInlineDrawerActive =
    showDesktopInspector && inspectorDrawerLayout === "inline" && drawerOpen;
  const isMobileEditing = isMobileViewport && isWheelOpen && !readonly;

  return (
    <>
      {noteId && !fullscreenTimerBlock ? <HaltedRunNotice noteId={noteId} /> : null}
      <div
        ref={editorWrapperRef}
        className={isInlineDrawerActive ? "flex w-full min-w-0 items-stretch" : "contents"}
      >
        <div
          ref={editorRef}
          data-mobile-editing={isMobileEditing ? "true" : undefined}
          onBlur={(e) => {
            if (!isMobileViewport || !isWheelOpen) return;
            const related = e.relatedTarget as HTMLElement | null;
            if (related && editorRef.current?.contains(related)) return;
            if (!related && Date.now() < deckInteractionUntilRef.current) return;
            setIsWheelOpen(false);
            setIsMobileTypingMode(false);
          }}
          className={`cm-note-editor relative w-full min-w-0 flex-1 ${className}`}
        >
          {enableOverlay && (
            <OverlayTrack
              view={activeView}
              widths={overlayState.widths}
              activeSectionId={effectiveActiveSectionId}
              renderSlot={renderSlot}
              cursorLine={cursorLine}
            />
          )}
          {runError && <p role="alert" className="text-sm text-destructive">Workout not started. {runError} Your draft is kept.</p>}
          {!enableOverlay && effectiveCommands.length > 0 && (
            <InlineCommandBar
              view={activeView}
              commands={effectiveCommands}
            />
          )}
          {!readonly && !isMobileViewport && (
            <SelectionFormatBar
              view={activeView}
              cursorVersion={cursorVersion}
            />
          )}
          {/* Cursor-focus metric panel — Option A token strip anchored below or
              adjacent to the cursor line inside WOD blocks (ADR-0009). */}
          <MetricInlinePanel
            view={activeView}
            cursorVersion={cursorVersion}
            noteId={noteId}
            hidden={isMobileViewport && isWheelOpen}
            activeTokenId={activeInspectorToken?.id ?? null}
            drawerOpen={drawerOpen}
            onOpenInspector={(req) => {
              if (activeView) closeCompletion(activeView);
              setInspectorMode(req.mode);
              setSelectedTokenId(req.token?.id ?? null);
              setPopoverAnchorRect(req.anchorRect);
              setPopoverOpen(!drawerOpen);
            }}
            onToggleDrawer={() => {
              setDrawerOpen((prev) => {
                const next = !prev;
                if (next) {
                  if (activeView) closeCompletion(activeView);
                  setPopoverOpen(false);
                }
                return next;
              });
            }}
          />
          {showDesktopInspector && popoverOpen && !drawerOpen && (
            <WhiteboardInspectorPopover
              open={popoverOpen}
              anchorRect={popoverAnchorRect}
              editorDom={activeView?.dom ?? null}
              view={activeView}
              mode={inspectorMode}
              inspection={lineInspection}
              token={activeInspectorToken}
              scope={notebookScope}
              docText={liveDocText}
              onClose={() => setPopoverOpen(false)}
              onMutate={(diff) => handleInspectorMutate(diff)}
              onModeChange={setInspectorMode}
              onStepToken={handleStepInspectorToken}
              onDockDrawer={() => {
                setPopoverOpen(false);
                setDrawerOpen(true);
              }}
            />
          )}
          {isMobileViewport && !readonly && (
            <MobileWheelComposer
              view={activeView}
              noteId={noteId}
              cursorVersion={cursorVersion}
              isOpen={isWheelOpen}
              isTypingMode={isMobileTypingMode}
              onSwitchToTyping={setIsMobileTypingMode}
              onDeckInteract={() => {
                deckInteractionUntilRef.current = Date.now() + 300;
              }}
              onClose={() => {
                setIsWheelOpen(false);
                setIsMobileTypingMode(false);
              }}
            />
          )}
          {fullscreenTimerBlock && viewRef.current && (
            <FullscreenTimer
              block={fullscreenTimerBlock}
              view={activeView}
              onClose={handleTimerClose}
              onCompleteWorkout={handleCompleteWorkout}
              resultId={fullscreenResultId ?? undefined}
              noteId={noteId}
              autoStart={autoStartFullscreen}
            />
          )}

          <EditorCastBridge
            sections={sections}
            isRuntimeActive={fullscreenTimerBlock !== null}
            editorState={activeView?.state ?? null}
            onSelectBlock={handleCastSelectBlock}
          />
        </div>

        {showDesktopInspector && drawerOpen && (
          <WhiteboardInspectorDrawer
            open={drawerOpen}
            layout={inspectorDrawerLayout}
            view={activeView}
            mode={inspectorMode}
            inspection={lineInspection}
            token={activeInspectorToken}
            scope={notebookScope}
            docText={liveDocText}
            lastEditDiff={lastEditDiff}
            onClose={() => setDrawerOpen(false)}
            onModeChange={setInspectorMode}
            onMutate={(diff) => handleInspectorMutate(diff)}
            onStepToken={handleStepInspectorToken}
          />
        )}
      </div>
      <AddToDashboardSheet
        open={dashboardSheetCtx !== null}
        onOpenChange={(open) => {
          if (!open) setDashboardSheetCtx(null);
        }}
        context={dashboardSheetCtx}
      />
    </>
  );
};

// ---------- Completion wiring (module-level; see note in NoteEditor) ----------

const markdownProseCompletionSource: CustomCompletionSource =
  createMarkdownProseCompletionSource();

/** Frontmatter tag/reference completions, scoped to leading frontmatter via
 *  the customCompletionSources facet (per editor state — never a global
 *  registry). Reads only module singletons, so the identity is stable across
 *  the mode-sync reconfigure. */
const frontmatterCompletionSource: CustomCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
  if (!isLeadingFrontmatter(context.state, context.pos)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const propMatch = textBefore.match(/^([a-zA-Z][\w.-]*)$/);
  const valueContext = frontmatterValueContext(context.state, context.pos);
  if (!propMatch && !valueContext) return null;

  const [tagTypes, allTags] = await Promise.all([
    storageService.getAllTagTypes().catch(() => []),
    storageService.getAllTags().catch(() => []),
  ]);

  if (propMatch) {
    return {
      from: line.from,
      options: tagTypes.map((t) => ({
        label: t.name,
        detail: `Tag Type (${t.label})`,
        type: 'property',
        apply: `${t.name}:\n  - `,
      })),
      validFor: (text, _from, to, state) =>
        /^[a-zA-Z][\w.-]*$/.test(text) && isLeadingFrontmatter(state, to),
    };
  }

  if (!valueContext) return null;
  const { propertyKey, from: wordFrom } = valueContext;

  // Durable reference values (note defaults + definition lists) complete
  // from the same catalog the resolver uses; the slug is what's authored.
  const REF_VALUE_KIND: Record<string, 'effort' | 'equipment'> = {
    effort: 'effort',
    'metrics.effort': 'effort',
    'metrics.equipment': 'equipment',
    equipment: 'equipment',
  };
  const refKind = REF_VALUE_KIND[propertyKey.toLowerCase()];
  if (refKind) {
    const catalog = await loadReferenceCatalog();
    const rows = refKind === 'effort' ? catalog.efforts : catalog.equipment;
    return {
      from: wordFrom,
      options: rows.map((row) => ({
        label: `${row.label} (${row.slug})`,
        detail: refKind === 'effort' ? 'Effort' : 'Equipment',
        type: 'constant',
        apply: row.slug,
      })),
      validFor: (text, from, to, state) => {
        const current = frontmatterValueContext(state, to);
        return /^[\w-]*$/.test(text) && current?.propertyKey === propertyKey && current.from === from;
      },
    };
  }

  const lowerKey = propertyKey.toLowerCase();
  const matchingType = tagTypes.find((t) => t.name.toLowerCase() === lowerKey);
  const matchingTags = matchingType
    ? allTags.filter((t) => t.type?.toLowerCase() === matchingType.name.toLowerCase())
    : [];
  if (matchingType && matchingTags.length > 0) {
    return {
      from: wordFrom,
      options: matchingTags.map((t) => ({
        label: t.label,
        detail: matchingType.label,
        type: 'constant',
      })),
      validFor: (text, from, to, state) => {
        const current = frontmatterValueContext(state, to);
        return /^[\w-]*$/.test(text) && current?.propertyKey === propertyKey && current.from === from;
      },
    };
  }

  if (lowerKey === 'discipline') {
    return {
      from: wordFrom,
      options: EFFORT_DISCIPLINES.map((discipline) => ({
        label: discipline,
        detail: 'Discipline',
        type: 'constant',
      })),
      validFor: (text, from, to, state) => {
        const current = frontmatterValueContext(state, to);
        return /^[\w-]*$/.test(text) && current?.propertyKey === propertyKey && current.from === from;
      },
    };
  }

  if (lowerKey === 'intensity' || lowerKey === 'intensitytier') {
    return {
      from: wordFrom,
      options: ['low', 'moderate', 'high'].map((tier) => ({
        label: tier,
        detail: 'Intensity',
        type: 'constant',
      })),
      validFor: (text, from, to, state) => {
        const current = frontmatterValueContext(state, to);
        return /^[\w-]*$/.test(text) && current?.propertyKey === propertyKey && current.from === from;
      },
    };
  }

  return null;
};

// ---------- Helpers ----------

function isLeadingFrontmatter(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  if (line.number === 1 || state.doc.line(1).text.trim() !== "---") return false;
  for (let number = 2; number <= line.number; number++) {
    if (/^(---|\.\.\.)\s*$/.test(state.doc.line(number).text)) return false;
  }
  return true;
}

function frontmatterValueContext(state: EditorState, pos: number): { propertyKey: string; from: number; value: string } | null {
  if (!isLeadingFrontmatter(state, pos)) return null;
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  const inline = textBefore.match(/^([a-zA-Z][\w.-]*)\s*:\s*(.*)$/);
  if (inline) return { propertyKey: inline[1], from: pos - inline[2].length, value: inline[2] };
  const list = textBefore.match(/^\s*-\s*(.*)$/);
  if (!list) return null;
  for (let number = line.number - 1; number > 1; number--) {
    const property = state.doc.line(number).text.match(/^([a-zA-Z][\w.-]*)\s*:/);
    if (property) return { propertyKey: property[1], from: pos - list[1].length, value: list[1] };
  }
  return null;
}

/** Convert an EditorSection to a ScriptBlock for callback compatibility */
function sectionToScriptBlock(section: EditorSection, state: EditorState): ScriptBlock | null {
  if (section.type !== "time" && section.type !== "log") return null;

  const content =
    section.contentFrom !== undefined && section.contentTo !== undefined
      ? state.doc.sliceString(section.contentFrom, section.contentTo)
      : "";

  let statements: ICodeStatement[] = [];
  try {
    if (content.trim()) {
      statements = createParser({ tags: getTagIndex() }).read(content, section.sport).statements ?? [];
    }
  } catch {
    // Silently ignore parse errors
  }

  return {
    id: section.id,
    contentId: section.contentId,
    dialect: section.type,
    sport: section.sport,
    startLine: section.startLine - 1, // Convert to 0-indexed for ScriptBlock compat
    endLine: section.endLine - 1,
    content,
    statements,
    state: "idle",
    version: state.field(sectionField).noteBlocks[section.id]?.version ?? 1,
    createdAt: Date.now(),
    widgetIds: {},
  };
}

/** Notify parent of block changes by extracting ScriptBlocks from section state */
function notifyBlockChanges(
  state: EditorState,
  onBlocksChange: ((blocks: ScriptBlock[]) => void) | undefined,
  lastBlocksJsonRef: React.RefObject<string>
) {
  if (!onBlocksChange) return;

  const sectionState: SectionState = state.field(sectionField);
  const blocks = sectionState.sections
    .filter((s) => s.type === "time" || s.type === "log")
    .map((s) => sectionToScriptBlock(s, state))
    .filter((b): b is ScriptBlock => b !== null);

  const blocksJson = JSON.stringify(
    blocks.map((b) => ({ id: b.id, startLine: b.startLine, endLine: b.endLine, content: b.content }))
  );

  if (blocksJson !== lastBlocksJsonRef.current) {
    lastBlocksJsonRef.current = blocksJson;
    onBlocksChange(blocks);
  }
}
