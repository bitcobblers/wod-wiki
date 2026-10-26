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

import { getTagIndex } from '@/services/tags/tagCatalogue';
import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { EditorState, Prec, StateEffect, type Extension } from "@codemirror/state";
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
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { acceptCompletion, completionKeymap, completionStatus, closeCompletion, closeBrackets, closeBracketsKeymap, startCompletion } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { markdown } from "@codemirror/lang-markdown";

import { editorTheme } from '@bitcobblers/wod-wiki-ui/extensions';
import { smartIncrement } from '@bitcobblers/wod-wiki-ui/extensions';

// Note editor extensions
import { sectionField, SectionState, activeCursorSection, type EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import { sectionIdentity, sectionIdentityHistory, registeredSectionWidgets, sectionSaved, sectionRestore } from '@bitcobblers/wod-wiki-ui/extensions';
import type { NoteBlock } from '@/types/storage';
import { reconcileNoteBlocks, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import { captureRun, type CapturedRun } from '@/services/runCapture';
import { createResultRecorder } from '@/services/resultRecorder';
import { sessionQueryInsert } from '@bitcobblers/wod-wiki-ui/extensions';
import { previewDecorations } from '@bitcobblers/wod-wiki-ui/extensions';
import { embedPreviewDecorations } from '@bitcobblers/wod-wiki-ui/extensions';
import { frontmatterPreview, frontmatterVisibility } from '@bitcobblers/wod-wiki-ui/extensions';
import { markdownTablePreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { linkPreview } from '@bitcobblers/wod-wiki-ui/extensions';
import { markdownSyntaxHiding } from '@bitcobblers/wod-wiki-ui/extensions';
import { wodLinter } from '@bitcobblers/wod-wiki-ui/extensions';
import { wodAutocompletion, wodEditorKeymap, wodAutoWrap, autocompleteTooltipTheme, customCompletionSources, nestedCompletionOptions, resolveCodeLanguage, type CustomCompletionSource, type NestedCompletionOptions } from '@bitcobblers/wod-wiki-ui/extensions';
import { loadSuggestions } from '@bitcobblers/wod-wiki-ui';
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
import { cursorFocusExtension, getCursorFocusState } from "@/app/editor/cursorFocusExtension";

import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { INotePersistence } from "@/services/persistence";
import { queryService, onResultSaved } from "@/hooks/useCastSignaling";
import { createFileDropHandler, createFrontmatterSuggestions, createFrontmatterReferenceProvider, loadReferenceCatalog, resolveNotePersistence } from "@/app/editor/noteEditorServices";
import { readSoundProfiles } from "@/services/sound/soundProfiles";

import { entryOpenHref } from '../../../../app/lib/entryActions';
import { toEntry, blockToEntry } from '../../../../app/lib/entryMapper';
import { OverlayTrack } from "@/components/organisms/editor/OverlayTrack";
import { useOverlayWidthState } from "@/components/Editor/overlays/useOverlayWidthState";
import type { OverlaySlotProps } from "@/components/organisms/editor/OverlayTrack";
import { FrontmatterCompanion } from "@/components/organisms/editor/FrontmatterCompanion";
import { WhiteboardCompanion } from "@/components/organisms/editor/WhiteboardCompanion";
import { WidgetCompanion } from "@/components/organisms/editor/WidgetCompanion";
import type { WidgetRegistry } from "@/components/Editor/widgets/types";
import type { ScriptCommand } from "@/components/Editor/overlays/ScriptCommand";
import { FullscreenTimer } from "@/components/organisms/review/FullscreenTimer";
import { InlineCommandBar } from "@/components/organisms/editor/InlineCommandBar";
import { EditorCastBridge } from "@/components/organisms/editor/EditorCastBridge";
import { MetricInlinePanel } from "@/components/organisms/editor/MetricInlinePanel";
import { v7 as uuidv7 } from "uuid";

import { themeCompartment, languageCompartment, modeCompartment } from "@/components/Editor/compartments";

import type { ScriptBlock } from "@/components/Editor/types";
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store';
import { Play, Plus, ExternalLink, Copy, Check } from "lucide-react";
import { buildHomeShareUrl, buildPlaygroundUrl } from "@/components/atoms/WhiteboardPlaygroundButton";

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
}
export interface EditorIdentitySnapshot {
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  sourceRevision: number;
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
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const defaultNotePersistenceRef = useRef<INotePersistence | null>(null);
  // Per-instance block-notification dedupe (#885): two editors with identical
  // content (home hero + runway window) must each seed their own blocks — a
  // module-level dedupe swallows the second editor's seed entirely.
  const lastBlocksJsonRef = useRef("");
  // Per-editor completion wiring lives at module scope (below) and rides in
  // baseExtensions: the mode-sync effect applies a full StateEffect.reconfigure
  // after mount, so facet values mounted anywhere else would be dropped (the
  // retired module-global registry existed for the same reason).

  const isDark = theme === "dark" || theme === "vs-dark";
  const notePersistence = resolveNotePersistence(defaultNotePersistenceRef, providedNotePersistence);

  // Overlay track state
  const [cursorSectionId, setCursorSectionId] = useState<string | null>(null);
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorVersion, setCursorVersion] = useState(0);
  const effectiveActiveSectionId = externalActiveSectionId ?? cursorSectionId;
  const overlayState = useOverlayWidthState(sections, effectiveActiveSectionId);

  const [viewInstance, setViewInstance] = useState<EditorView | null>(null);
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
      }, block, uuidv7(), noteId ? undefined : 'playground', notePersistence);
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
      handleRun(block, true);
    }
  }, [enableInlineRuntime, handleRun]);

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
        buildPlaygroundUrl(block.content).then((url) => {
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
      Prec.highest(keymap.of([
        {
          key: "Tab",
          run: (view) => {
            if (completionStatus(view.state) === null) return false;
            acceptCompletion(view);
            return true;
          },
        },
        {
          key: "Enter",
          run: (view) => {
            const selection = view.state.selection.main;
            const context = frontmatterValueContext(view.state, selection.head);
            const line = view.state.doc.lineAt(selection.head);
            if (!selection.empty || context?.value.trim() !== "" ||
                line.text.slice(selection.head - line.from).trim()) return false;
            closeCompletion(view);
            return insertNewlineAndIndent(view);
          },
        },
      ])),
      keymap.of([
        ...closeBracketsKeymap,
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
            void onSaveRequest?.();
            return true;
          },
        },
        {
          key: "Ctrl-.",
          run: (view) => {
            const focus = getCursorFocusState(view.state);
            if (!focus?.focusedMetric) return false;
            const type = focus.focusedMetric.type as string;
            const numeric = new Set(["duration", "rep", "rounds", "distance", "resistance"]);
            if (numeric.has(type)) return false;

            // Editor owns the segment loop — palette knows nothing about segments.
            import('@/components/organisms/command-palette/palette-store').then(() => {
              import('@/components/Editor/services/statementBuilderFlow').then(({ runStatementBuilderFlow }) => {
                runStatementBuilderFlow(focus, view);
              }).catch(() => {
                usePaletteStore.getState().open({ placeholder: 'Modify metric…', sources: [] });
              });
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
      sectionIdentity.of({ blocks: noteBlocks ?? reconcileNoteBlocks(value, { sourceRevision: Math.max(1, sourceRevision), registeredWidgets: widgetComponents ? [...widgetComponents.keys()] : KNOWN_SECTION_WIDGETS }), sourceRevision: Math.max(1, sourceRevision), rawContent: value }),
      registeredSectionWidgets.of(widgetComponents ? [...widgetComponents.keys()] : KNOWN_SECTION_WIDGETS),
      sectionIdentityHistory,
      frontmatterVisibility.of(showFrontmatter),
      ...(enablePreview || !showFrontmatter ? [frontmatterPreview] : []),

      // Block-level preview decorations
      ...(enablePreview ? [
        previewDecorations,
        embedPreviewDecorations,
        createFrontmatterSuggestions(),
        createFrontmatterReferenceProvider(),
        markdownTablePreview,
        markdownSyntaxHiding(),
        linkPreview,
      ] : []),

      // Whiteboard Script linting (no separate lintGutter — unified gutter handles it)
      ...(enableLinting ? [wodLinter] : []),

      // Autocomplete (fence-tag + embed completions), the shared tooltip
      // theme, and fence wrapping
      wodAutocompletion,
      autocompleteTooltipTheme,
      wodEditorKeymap,
      wodAutoWrap,
      // Per-editor completion sources (facet values must ride in
      // baseExtensions to survive the mode-sync reconfigure).
      customCompletionSources.of(frontmatterCompletionSource),
      nestedCompletionOptions.of(NOTE_NESTED_WQL_OPTIONS),

      // Overlay panel for Whiteboard Script blocks
      ...(enableOverlay ? [wodOverlayPanel] : []),

      // Section geometry measurement (for overlay track)
      sectionGeometry,

      // Ctrl+Click link opening
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

      // Blur handler — fires when the editor loses focus
      EditorView.domEventHandlers({
        blur: () => { onBlur?.(); return false; },
      }),

      // Update listener
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const identity = update.state.field(sectionField);
          onIdentityChange?.({ rawContent: identity.rawContent, blocks: identity.noteBlocks, sourceRevision: identity.sourceRevision });
          onChange(identity.rawContent);
          onDocUpdate?.(update);
          notifyBlockChanges(update.state, onBlocksChange, lastBlocksJsonRef);
          // Typing-like transactions stay coalesced; everything else (widget
          // commits, query-block inserts, undo) is a deliberate commit — save now.
          const typed = update.transactions.some(t =>
            t.isUserEvent("input") || t.isUserEvent("delete") || t.isUserEvent("paste") || t.isUserEvent("drop"));
          if (!typed) void onCommitChange?.();
        }
        if (update.selectionSet || update.docChanged) {
          setCursorVersion((version) => version + 1);
          if (update.transactions.some((transaction) => transaction.isUserEvent("delete.backward")) &&
              completionStatus(update.startState) !== null && completionStatus(update.state) === null &&
              frontmatterValueContext(update.state, update.state.selection.main.head)?.value === "") {
            queueMicrotask(() => {
              if (update.view.state === update.state) startCompletion(update.view);
            });
          }
          const { head } = update.state.selection.main;
          const line = update.state.doc.lineAt(head);
          onCursorPositionChange?.(line.number, head - line.from + 1);

          // Update overlay track state
          const cursorSec = activeCursorSection(update.state);
          setCursorSectionId(cursorSec?.id ?? null);
          setCursorLine(line.number);
          const { sections: secs } = update.state.field(sectionField);
          setSections(secs);
        }
      }),

      // Read-only state
      EditorState.readOnly.of(readonly),
      EditorView.editable.of(!readonly),
      ...(placeholderText ? [placeholder(placeholderText)] : []),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
    ],
    [
      onChange,
      onCursorPositionChange,
      onBlur,
      onDocUpdate,
      onBlocksChange,
      onIdentityChange,
      readonly,
      onSaveRequest,
      onCommitChange,
      showLineNums,
      initialLineWrapping,
      enablePreview,
      showFrontmatter,
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

    const state = EditorState.create({
      doc: value,

      extensions: [
        ...baseExtensions,
        themeCompartment.of(editorTheme(isDark)),
        languageCompartment.of(languages),
        modeCompartment.of([]),
        ...(extraExtensions ?? []),
      ],
    });

    const view = new EditorView({
      state,
      parent: mountNode,
    });

    const viewport = window.visualViewport;
    let keyboardScrollFrame = 0;
    const revealKeyboardCaret = () => {
      cancelAnimationFrame(keyboardScrollFrame);
      keyboardScrollFrame = requestAnimationFrame(() => {
        if (view.hasFocus && viewport?.scale === 1 && viewport.height < window.innerHeight) {
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest", yMargin: 24 }),
          });
        }
      });
    };
    viewport?.addEventListener("resize", revealKeyboardCaret);
    view.contentDOM.addEventListener("focus", revealKeyboardCaret);

    viewRef.current = view;
    setViewInstance(view);
    const _shouldExposeCodemirrorView = import.meta.env.MODE === 'test'
      || (import.meta.env.DEV && window.navigator.webdriver);
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
    if (value !== identity.rawContent) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        // Unsaved fallbacks carry revision 0 with blocks stamped at 1 — the
        // restore validation requires a matching stamp (Math.max, as init).
        ...(noteBlocks ? { effects: sectionRestore.of({ rawContent: value, blocks: noteBlocks, sourceRevision: Math.max(1, sourceRevision) }) } : {}),
      });
    } else if (noteBlocks && sourceRevision !== identity.sourceRevision) {
      view.dispatch({ effects: sectionSaved.of({ blocks: noteBlocks, sourceRevision: Math.max(1, sourceRevision) }) });
    }
  }, [value, noteBlocks, sourceRevision]);

  // Sync theme
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeCompartment.reconfigure(editorTheme(isDark)),
      });
    }
  }, [isDark]);

  // Sync mode and extensions
  useEffect(() => {
    if (viewRef.current) {
      const modeExtensions: Extension = mode === "track" ? [] : [];
      viewRef.current.dispatch({
        effects: [
          StateEffect.reconfigure.of([
            ...baseExtensions,
            themeCompartment.of(editorTheme(isDark)),
            languageCompartment.of(languages),
            modeCompartment.of(modeExtensions),
            ...(extraExtensions ?? []),
          ]),
        ],
      });
    }
  }, [baseExtensions, extraExtensions, mode, isDark, languages]);

  // Focus on open / readonly→editable transition. Must stay AFTER the
  // reconfigure effect above: .cm-content only takes focus once the view is
  // actually editable (previously activeElement stayed on the Edit button).
  useEffect(() => {
    if (!readonly) viewRef.current?.focus();
  }, [readonly]);

  // Handle external scroll requests
  useEffect(() => {
    if (scrollToSectionId && viewRef.current) {
      const view = viewRef.current;
      const content = view.state.doc.toString();
      const lines = content.split("\n");
      
      let lineIdx = -1;

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

  return (
    <div
      ref={editorRef}
      className={`cm-note-editor relative w-full min-w-0 ${className}`}
    >
      {enableOverlay && (
        <OverlayTrack
          view={viewInstance ?? viewRef.current}
          widths={overlayState.widths}
          activeSectionId={effectiveActiveSectionId}
          renderSlot={renderSlot}
          cursorLine={cursorLine}
        />
      )}
      {runError && <p role="alert" className="text-sm text-destructive">Workout not started. {runError} Your draft is kept.</p>}
      {!enableOverlay && effectiveCommands.length > 0 && (
        <InlineCommandBar
          view={viewInstance ?? viewRef.current}
          commands={effectiveCommands}
        />
      )}
      {/* Cursor-focus metric panel — fixed-position chip row below the
          cursor line inside WOD blocks (ADR-0009). Rendered regardless of
          enableOverlay: it anchors to the cursor, not a section slot. */}
      <MetricInlinePanel
        view={viewInstance ?? viewRef.current}
        cursorVersion={cursorVersion}
      />
      {fullscreenTimerBlock && viewRef.current && (
        <FullscreenTimer
          block={fullscreenTimerBlock}
          view={viewInstance ?? viewRef.current}
          onClose={handleTimerClose}
          onCompleteWorkout={handleCompleteWorkout}
          resultId={fullscreenResultId ?? undefined}
          autoStart={autoStartFullscreen}
        />
      )}

      <EditorCastBridge
        sections={sections}
        isRuntimeActive={fullscreenTimerBlock !== null}
        editorState={(viewInstance ?? viewRef.current)?.state ?? null}
        onSelectBlock={handleCastSelectBlock}
      />

    </div>
  );
};

// ---------- Completion wiring (module-level; see note in NoteEditor) ----------

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

  const matchingType = tagTypes.find((t) => t.name.toLowerCase() === propertyKey.toLowerCase());
  if (!matchingType) return null;

  const matchingTags = allTags.filter((t) => t.type?.toLowerCase() === matchingType.name.toLowerCase());
  if (matchingTags.length === 0) return null;

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
};

// Exactly the wqlCompletionSource options the standalone WQL editors configure,
// so nested ```query/```wql bodies rank, apply, and insert identically.
const NOTE_NESTED_WQL_OPTIONS: NestedCompletionOptions = {
  wql: {
    values: async (key) =>
      (await loadSuggestions(key === 'tags' ? 'tag' : key)).map((item) => ({
        label: item.value,
        detail: item.label,
        type: 'constant' as const,
      })),
  },
  // Exactly the WhiteboardScriptCompletionOptions a standalone WB editor gets:
  // efforts/equipment from the shared reference catalog, tags from the cached
  // tag index, sound profiles from the sound service. The provider's sport
  // comes from each section's `:sport` fence suffix, not here.
  whiteboardScript: {
    efforts: async () =>
      (await loadReferenceCatalog()).efforts.map((effort) => ({
        value: effort.slug,
        label: `${effort.label} (${effort.slug})`,
      })),
    equipment: async () =>
      (await loadReferenceCatalog()).equipment.map((item) => ({
        value: item.slug,
        label: `${item.label} (${item.slug})`,
      })),
    tags: async () => getTagIndex().list().map((tag) => ({ value: tag.slug })),
    sounds: () =>
      readSoundProfiles().map((profile) => ({ value: profile.id, label: profile.name })),
  },
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
  lastBlocksJsonRef: React.MutableRefObject<string>
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
