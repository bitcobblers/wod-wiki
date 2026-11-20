import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import {
  Check,
  Dumbbell,
  Hash,
  Keyboard,
  Layers,
  PanelRight,
  Plus,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  AlertTriangle,
  Wrench,
  X,
} from 'lucide-react';
import {
  PROTO_SCENARIOS,
  computeDeleteTokenChange,
  computeInsertTemplateChange,
  computeInsertTokenChange,
  computeReplaceTokenChange,
  computeToggleFrontmatterTagChange,
  computeToggleProseFormatChange,
  computeUpdateFenceChange,
  createInitialCatalogs,
  scanDocument,
  slugify,
  tokenChipDescriptor,
  type CatalogStore,
  type Dialect,
  type DocAnalysis,
  type DocBlock,
  type ParsedToken,
  type ScenarioPreset,
} from './whiteboard-editor-proto/whiteboardProtoEngine';
import {
  catalogRefreshEffect,
  createProtoInputModeCompartment,
  createWhiteboardProtoExtensions,
  protoUiEffect,
  type ProtoCmCallbacks,
} from './whiteboard-editor-proto/cmWhiteboardExtensions';
import { TokenInspectorBody, type InspectorMode } from './whiteboard-editor-proto/TokenInspectorBody';
import './whiteboard-editor-proto/whiteboardProto.css';

type ViewportSim = 'desktop' | 'tablet' | 'mobile';

interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

function initialCursorOffsetFor(docText: string, analysis: DocAnalysis, target: ScenarioPreset['focusTarget']): number {
  const lines = docText.split('\n');
  const lineStartOffset = (lineNum: number): number => {
    let off = 0;
    for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
      off += lines[i].length + 1;
    }
    return off;
  };

  if (target === 'first-prose') {
    const proseLines = Array.from(analysis.proseLineSet).sort((a, b) => a - b);
    const pick = proseLines[1] ?? proseLines[0];
    if (pick) return lineStartOffset(pick);
  }
  const firstBlock = analysis.blocks[0];
  if (firstBlock) {
    const lineNum = firstBlock.lines[1]?.lineNum ?? firstBlock.lines[0]?.lineNum ?? firstBlock.contentStartLine;
    return lineStartOffset(Math.max(1, lineNum));
  }
  return 0;
}

export default function WhiteboardEditorPrototypePage() {
  const [vp, setVp] = useState<ViewportSim>('desktop');
  const [windowWidth, setWindowWidth] = useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [scenId, setScenId] = useState<ScenarioPreset['id']>('emom');

  // Option A (anchored popover) + Optional Option B Drawer (right rail)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverAnchor, setPopoverAnchor] = useState<AnchorRect | null>(null);

  const [editorMode, setEditorMode] = useState<InspectorMode>('token');
  const [activeTokenId, setActiveTokenId] = useState<string | null>(null);
  const [activeBlockIdx, setActiveBlockIdx] = useState<number>(0);

  const [mobileDeckOpen, setMobileDeckOpen] = useState(true);
  const [mobileTypingMode, setMobileTypingMode] = useState(false);
  const [mobileUseScrubber, setMobileUseScrubber] = useState(false);

  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const [overflowBlockIdx, setOverflowBlockIdx] = useState<number | null>(null);
  const [overflowPos, setOverflowPos] = useState<{ top: number; right: number }>({ top: 100, right: 16 });
  const [lastEditDiff, setLastEditDiff] = useState<{ from: string; to: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const catalogsRef = useRef<CatalogStore>(createInitialCatalogs());
  const [, setCatalogVersion] = useState(0);

  const initialScenario = PROTO_SCENARIOS.emom;
  const initialAnalysis = useMemo(() => scanDocument(initialScenario.doc, catalogsRef.current), [initialScenario.doc]);

  const [analysis, setAnalysis] = useState<DocAnalysis>(initialAnalysis);
  const [cursorLineNum, setCursorLineNum] = useState<number>(() => initialAnalysis.blocks[0]?.lines[1]?.lineNum ?? 11);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [composerLift, setComposerLift] = useState<number>(18);

  const appFrameRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const mobileDeckRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const inputModeCompRef = useRef(createProtoInputModeCompartment());
  const toastTimerRef = useRef<number | null>(null);

  const isMobile = vp === 'mobile' || windowWidth <= 767;
  const isTablet = !isMobile && (vp === 'tablet' || (windowWidth > 767 && windowWidth <= 960));

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showToast = useCallback((msg: string) => {
    if (!msg) return;
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const toFrameAnchor = useCallback((el: HTMLElement | null): AnchorRect | null => {
    if (!el || !appFrameRef.current) return null;
    const r = el.getBoundingClientRect();
    const f = appFrameRef.current.getBoundingClientRect();
    return {
      left: r.left - f.left,
      top: r.top - f.top,
      right: r.right - f.left,
      bottom: r.bottom - f.top,
      width: r.width,
    };
  }, []);

  const activeWodEntry = analysis.wodLineMap.get(cursorLineNum) ?? null;
  const activeLineTokens = useMemo(() => activeWodEntry?.parsed.tokens ?? [], [activeWodEntry]);

  const activeToken = useMemo(() => {
    if (!activeLineTokens.length) return null;
    return activeLineTokens.find((t) => t.id === activeTokenId) ?? activeLineTokens[0];
  }, [activeLineTokens, activeTokenId]);

  const activeBlock: DocBlock | null = useMemo(() => {
    if (activeWodEntry) return analysis.blocks[activeWodEntry.blockIdx] ?? null;
    return analysis.blocks[activeBlockIdx] ?? analysis.blocks[0] ?? null;
  }, [activeWodEntry, analysis.blocks, activeBlockIdx]);

  const isProseActive = analysis.proseLineSet.has(cursorLineNum);

  const jumpToLine = useCallback((lineNum: number, token?: ParsedToken) => {
    const view = viewRef.current;
    if (!view || lineNum < 1 || lineNum > view.state.doc.lines) return;
    const line = view.state.doc.line(lineNum);
    const anchor = token ? Math.min(line.from + token.from, line.to) : line.from;
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: 'nearest' }),
    });
    if (!isMobile || mobileTypingMode) {
      view.focus();
    }
  }, [isMobile, mobileTypingMode]);

  const openInspectorForMode = useCallback(
    (mode: InspectorMode, tokenId: string | null, anchorEl: HTMLElement | null) => {
      setEditorMode(mode);
      if (tokenId !== undefined) setActiveTokenId(tokenId);
      if (isMobile) {
        setMobileDeckOpen(true);
        setMobileTypingMode(false);
        return;
      }
      if (drawerOpen) {
        setPopoverOpen(false);
      } else {
        setPopoverAnchor(toFrameAnchor(anchorEl));
        setPopoverOpen(true);
      }
    },
    [drawerOpen, isMobile, toFrameAnchor],
  );

  // Sync CodeMirror mutations cleanly while preserving single-line bounds & token selection
  const handleReplaceToken = useCallback(
    (tok: ParsedToken, nextText: string) => {
      const view = viewRef.current;
      if (!view) return;
      const targetLine = cursorLineNum;
      const change = computeReplaceTokenChange(view.state.doc, targetLine, tok, nextText, catalogsRef.current);
      if (!change) return;

      const prevRaw = tok.raw;
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.nextCursorPos },
      });

      const nextDocLine = view.state.doc.line(targetLine);
      const nextParsed = scanDocument(view.state.doc.toString(), catalogsRef.current).wodLineMap.get(targetLine)?.parsed;
      const matched = nextParsed?.tokens.find((t) => t.raw === change.insert && nextDocLine.from + t.from >= change.from - 2);
      if (matched) setActiveTokenId(matched.id);

      setLastEditDiff({ from: prevRaw, to: change.insert });
      showToast(`Updated → ${change.insert}`);
    },
    [cursorLineNum, showToast],
  );

  const handleDeleteToken = useCallback(
    (tok: ParsedToken) => {
      const view = viewRef.current;
      if (!view) return;
      const change = computeDeleteTokenChange(view.state.doc, cursorLineNum, tok, catalogsRef.current);
      if (!change) return;
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.from + change.insert.length },
      });
      setActiveTokenId(null);
      showToast(`Removed ${tok.raw}`);
    },
    [cursorLineNum, showToast],
  );

  const handleInsertToken = useCallback(
    (textToInsert: string) => {
      const view = viewRef.current;
      if (!view) return;
      const targetLine = cursorLineNum;
      const change = computeInsertTokenChange(view.state.doc, targetLine, textToInsert);
      if (!change) return;
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.nextCursorPos },
      });
      const clean = textToInsert.trim();
      const nextParsed = scanDocument(view.state.doc.toString(), catalogsRef.current).wodLineMap.get(targetLine)?.parsed;
      const lastMatch = [...(nextParsed?.tokens ?? [])].reverse().find((t) => t.raw === clean);
      if (lastMatch) {
        setActiveTokenId(lastMatch.id);
        setEditorMode('token');
      }
      showToast(`Inserted ${clean}`);
    },
    [cursorLineNum, showToast],
  );

  const handleDefineUnresolved = useCallback(
    (
      rawToken: string,
      actionType: 'effort' | 'equipment' | 'tag' | 'alias',
      aliasTargetId?: string,
      replaceCurrentToken?: boolean,
    ) => {
      const view = viewRef.current;
      if (!view) return;
      const cats = catalogsRef.current;
      let msg: string;

      if (rawToken.startsWith('#') || actionType === 'tag') {
        const slug = slugify(rawToken.replace(/^#/, ''));
        if (!cats.tags.some((t) => t.slug === slug)) {
          cats.tags = [{ slug, group: 'Custom', desc: 'Created inline in editor' }, ...cats.tags];
        }
        msg = `Created tag #${slug}`;
      } else if (actionType === 'equipment') {
        const eqName = rawToken.trim();
        cats.equipment = [{ id: slugify(eqName), name: eqName, desc: 'Custom equipment' }, ...cats.equipment];
        msg = `Added equipment ${eqName}`;
      } else if (actionType === 'alias' && aliasTargetId) {
        cats.efforts = cats.efforts.map((eff) =>
          eff.id === aliasTargetId ? { ...eff, aliases: [...eff.aliases, rawToken.toLowerCase()] } : eff,
        );
        const tgt = cats.efforts.find((e) => e.id === aliasTargetId);
        msg = `Aliased "${rawToken}" → ${tgt?.name ?? aliasTargetId}`;
      } else {
        const effName = rawToken.trim();
        cats.efforts = [
          {
            id: slugify(effName),
            name: effName,
            aliases: [],
            defaultEquipment: null,
            notebooks: [analysis.frontmatter.notebook || 'kettlebell'],
            recent: true,
            category: 'Custom',
          },
          ...cats.efforts,
        ];
        msg = `Defined effort "${effName}"`;
      }

      setCatalogVersion((v) => v + 1);
      view.dispatch({ effects: catalogRefreshEffect.of(Date.now()) });

      if (replaceCurrentToken && activeToken) {
        const change = computeReplaceTokenChange(view.state.doc, cursorLineNum, activeToken, rawToken.trim(), cats);
        if (change) {
          view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert } });
        }
      }
      showToast(msg);
    },
    [activeToken, analysis.frontmatter.notebook, cursorLineNum, showToast],
  );

  const handleUpdateFence = useCallback(
    (patch: { dialect?: Dialect; sport?: string }) => {
      const view = viewRef.current;
      const blk = activeBlock;
      if (!view || !blk) return;
      const change = computeUpdateFenceChange(view.state.doc, blk.fenceStartLine, patch);
      if (!change) return;
      view.dispatch({ changes: change });
      if (patch.dialect) showToast('Block dialect → ```' + patch.dialect);
      else if (patch.sport !== undefined) showToast(patch.sport ? `Sport → :${patch.sport}` : 'Sport → General');
    },
    [activeBlock, showToast],
  );

  const handleInsertTemplate = useCallback(
    (blockIdx: number, templateId: string) => {
      const view = viewRef.current;
      if (!view) return;
      const currentAnalysis = scanDocument(view.state.doc.toString(), catalogsRef.current);
      const blk = currentAnalysis.blocks[blockIdx] ?? activeBlock;
      if (!blk) return;
      const change = computeInsertTemplateChange(view.state.doc, blk, cursorLineNum, templateId);
      if (!change) return;
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.nextCursorPos },
        effects: EditorView.scrollIntoView(change.nextCursorPos, { y: 'nearest' }),
      });
      if (!drawerOpen && !isMobile) setPopoverOpen(false);
      setEditorMode('token');
      showToast(`Inserted ${templateId} template`);
    },
    [activeBlock, cursorLineNum, drawerOpen, isMobile, showToast],
  );

  const handleProseFormat = useCallback(
    (lineNum: number, kind: 'bold' | 'italic' | 'strike' | 'code' | 'wikiLink' | 'proseTag' | 'wrapTimeBlock', payload?: string) => {
      const view = viewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      const change = computeToggleProseFormatChange(view.state.doc, lineNum, sel.from, sel.to, kind, payload);
      if (!change) return;
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        ...(change.nextCursorPos !== undefined ? { selection: { anchor: change.nextCursorPos } } : {}),
      });
      if (kind === 'wrapTimeBlock') showToast('Wrapped into ```time block');
      else if (kind === 'wikiLink' && payload) showToast(`Inserted [[${payload}]]`);
      else if (kind === 'proseTag' && payload) showToast(`Inserted ${payload}`);
      else showToast(`Toggled ${kind}`);
    },
    [showToast],
  );

  const handleStepToken = useCallback(
    (delta: -1 | 1) => {
      if (!activeLineTokens.length) return;
      const idx = activeLineTokens.findIndex((t) => t.id === activeToken?.id);
      const nextIdx = (Math.max(0, idx) + delta + activeLineTokens.length) % activeLineTokens.length;
      const nextTok = activeLineTokens[nextIdx];
      setActiveTokenId(nextTok.id);
      setEditorMode('token');
    },
    [activeLineTokens, activeToken?.id],
  );

  const callbacksRef = useRef<ProtoCmCallbacks>({
    getCatalogs: () => catalogsRef.current,
    onSync: () => undefined,
    onPickToken: () => undefined,
    onPickAdd: () => undefined,
    onOpenBlock: () => undefined,
    onPlayBlock: () => undefined,
    onBlockCmdToast: () => undefined,
    onToggleOverflow: () => undefined,
    onApplyQuickFix: () => undefined,
    onInsertTemplate: () => undefined,
    onProseFormat: () => undefined,
    onOpenWikiPicker: () => undefined,
    onOpenProseTagPicker: () => undefined,
    onShortcutInspect: () => undefined,
    onToggleDrawer: () => undefined,
  });

  callbacksRef.current = {
    getCatalogs: () => catalogsRef.current,
    onSync: (view, nextAnalysis) => {
      setAnalysis(nextAnalysis);
      const lineNum = view.state.doc.lineAt(view.state.selection.main.head).number;
      setCursorLineNum(lineNum);
      setCanUndo(undoDepth(view.state) > 0);
      setCanRedo(redoDepth(view.state) > 0);

      const entry = nextAnalysis.wodLineMap.get(lineNum);
      if (entry) {
        setActiveBlockIdx(entry.blockIdx);
        const offset = view.state.selection.main.head - view.state.doc.line(lineNum).from;
        const tokAtCursor = entry.parsed.tokens.find((t) => offset >= t.from && offset <= t.to);
        if (tokAtCursor) {
          setActiveTokenId(tokAtCursor.id);
        } else {
          setActiveTokenId((prev) =>
            entry.parsed.tokens.some((t) => t.id === prev) ? prev : (entry.parsed.tokens[0]?.id ?? null),
          );
        }
        if (entry.parsed.tokens.length === 0 && isMobile) {
          setEditorMode('add');
        }
      } else if (nextAnalysis.proseLineSet.has(lineNum) && isMobile) {
        setEditorMode((prev) => (prev === 'prose-tag' || prev === 'fm-tag' ? prev : 'wiki'));
      }
    },
    onPickToken: (lineNum, tok, anchorEl) => {
      const view = viewRef.current;
      if (view) {
        const line = view.state.doc.line(lineNum);
        const targetPos = Math.min(line.from + tok.from, line.to);
        const curHead = view.state.selection.main.head;
        const curLine = view.state.doc.lineAt(curHead).number;
        if (curLine !== lineNum || curHead < line.from + tok.from || curHead > line.from + tok.to) {
          view.dispatch({
            selection: { anchor: targetPos },
            effects: EditorView.scrollIntoView(targetPos, { y: 'nearest' }),
          });
        }
      }
      openInspectorForMode('token', tok.id, anchorEl);
    },
    onPickAdd: (lineNum, anchorEl) => {
      const view = viewRef.current;
      if (view && view.state.doc.lineAt(view.state.selection.main.head).number !== lineNum) {
        jumpToLine(lineNum);
      }
      openInspectorForMode('add', null, anchorEl);
    },
    onOpenBlock: (blockIdx, anchorEl) => {
      setActiveBlockIdx(blockIdx);
      openInspectorForMode('block', null, anchorEl);
    },
    onPlayBlock: () => {
      showToast('Started live workout timer');
    },
    onBlockCmdToast: (msg) => showToast(msg),
    onToggleOverflow: (blockIdx, anchorEl) => {
      setOverflowBlockIdx((prev) => {
        if (prev === blockIdx) return null;
        const anchor = toFrameAnchor(anchorEl);
        const frameW = appFrameRef.current?.clientWidth ?? 390;
        if (anchor) {
          setOverflowPos({ top: anchor.bottom + 6, right: Math.max(10, frameW - anchor.right) });
        }
        return blockIdx;
      });
    },
    onApplyQuickFix: (lineNum, tok, fixVal) => {
      const view = viewRef.current;
      if (!view) return;
      const change = computeReplaceTokenChange(view.state.doc, lineNum, tok, fixVal, catalogsRef.current);
      if (!change) return;
      view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert } });
      setLastEditDiff({ from: tok.raw, to: change.insert });
      showToast(`Fixed → ${change.insert}`);
    },
    onInsertTemplate: handleInsertTemplate,
    onProseFormat: (lineNum, kind) => handleProseFormat(lineNum, kind),
    onOpenWikiPicker: (lineNum, anchorEl) => {
      jumpToLine(lineNum);
      openInspectorForMode('wiki', null, anchorEl);
    },
    onOpenProseTagPicker: (lineNum, anchorEl) => {
      jumpToLine(lineNum);
      openInspectorForMode('prose-tag', null, anchorEl);
    },
    onShortcutInspect: () => {
      if (isMobile) {
        setMobileDeckOpen(true);
        setMobileTypingMode(false);
        return;
      }
      if (drawerOpen) {
        const firstInput = document.querySelector<HTMLElement>('.wb-inspector-drawer button, .wb-inspector-drawer input');
        firstInput?.focus();
        return;
      }
      const activeChip = editorHostRef.current?.querySelector<HTMLElement>('.wb-tok-chip.is-active, .wb-tok-chip');
      const fallbackLine = editorHostRef.current?.querySelector<HTMLElement>('.cm-wb-block-line.is-active, .cm-activeLine');
      openInspectorForMode(activeLineTokens.length ? 'token' : 'add', activeToken?.id ?? null, activeChip ?? fallbackLine ?? null);
    },
    onToggleDrawer: () => {
      setDrawerOpen((prev) => {
        const next = !prev;
        if (next) setPopoverOpen(false);
        return next;
      });
    },
  };

  // Mount real CodeMirror 6 EditorView once
  useEffect(() => {
    if (!editorHostRef.current) return;
    const { extensions } = createWhiteboardProtoExtensions(
      { isMobile, activeTokenId, editorMode, overflowBlockIdx },
      callbacksRef,
      inputModeCompRef.current,
    );

    const startDoc = PROTO_SCENARIOS.emom.doc;
    const startAnalysis = scanDocument(startDoc, catalogsRef.current);
    const startOffset = initialCursorOffsetFor(startDoc, startAnalysis, 'first-wod');

    const view = new EditorView({
      doc: startDoc,
      selection: { anchor: startOffset },
      extensions,
      parent: editorHostRef.current,
    });
    viewRef.current = view;

    const lineNum = view.state.doc.lineAt(startOffset).number;
    setAnalysis(startAnalysis);
    setCursorLineNum(lineNum);
    setActiveTokenId(startAnalysis.wodLineMap.get(lineNum)?.parsed.tokens[0]?.id ?? null);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; updates sync via StateEffects & callbacksRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push UI state & inputMode changes to CodeMirror via StateEffects / Compartment
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        protoUiEffect.of({
          isMobile,
          activeTokenId: activeToken?.id ?? null,
          editorMode: popoverOpen || drawerOpen || isMobile ? editorMode : null,
          overflowBlockIdx,
        }),
        inputModeCompRef.current.reconfigure(
          EditorView.contentAttributes.of({ inputmode: isMobile && !mobileTypingMode ? 'none' : 'text' }),
        ),
      ],
    });
  }, [isMobile, mobileTypingMode, activeToken?.id, editorMode, popoverOpen, drawerOpen, overflowBlockIdx]);

  // Measure mobile deck lift for toast & scroll clearance
  useEffect(() => {
    if (isMobile && mobileDeckOpen && mobileDeckRef.current) {
      setComposerLift(Math.round(mobileDeckRef.current.getBoundingClientRect().height) + 12);
    } else if (isMobile) {
      setComposerLift(68);
    } else {
      setComposerLift(18);
    }
  }, [isMobile, mobileDeckOpen, mobileTypingMode, editorMode, activeToken?.id]);

  // Keep active CM6 cursor line visible when mobile deck opens or switches to Type mode
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isMobile || !mobileDeckOpen) return;
    const head = view.state.selection.main.head;
    view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'nearest' }) });
  }, [isMobile, mobileDeckOpen, mobileTypingMode, cursorLineNum]);

  // Switch Scenario preset cleanly
  const loadScenario = useCallback(
    (id: ScenarioPreset['id']) => {
      const view = viewRef.current;
      const scen = PROTO_SCENARIOS[id];
      if (!view || !scen) return;

      catalogsRef.current = createInitialCatalogs();
      setCatalogVersion((v) => v + 1);
      const nextAnalysis = scanDocument(scen.doc, catalogsRef.current);
      const anchor = initialCursorOffsetFor(scen.doc, nextAnalysis, scen.focusTarget);

      setScenId(id);
      setPopoverOpen(false);
      setLastEditDiff(null);
      setOverflowBlockIdx(null);
      setMobileDeckOpen(true);
      setMobileTypingMode(false);
      setEditorMode(scen.focusTarget === 'first-prose' ? 'wiki' : 'token');

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: scen.doc },
        selection: { anchor },
        effects: [catalogRefreshEffect.of(Date.now()), EditorView.scrollIntoView(anchor, { y: 'nearest' })],
      });
    },
    [],
  );

  // Close Option A Popover on Esc or outside click
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        callbacksRef.current.onToggleDrawer();
        return;
      }
      if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        callbacksRef.current.onShortcutInspect();
        return;
      }
      if (e.key === 'Escape') {
        if (entitiesOpen) {
          setEntitiesOpen(false);
          return;
        }
        if (popoverOpen) {
          setPopoverOpen(false);
          viewRef.current?.focus();
        }
        if (overflowBlockIdx !== null) {
          setOverflowBlockIdx(null);
        }
      }
    };
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        popoverOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !target.closest('.wb-tok-chip') &&
        !target.closest('.wb-dialect-pill') &&
        !target.closest('.wb-sport-pill') &&
        !target.closest('.wb-fm-pill') &&
        !target.closest('.wb-prose-tool-btn') &&
        !target.closest('[data-wb-inspect-trigger]')
      ) {
        setPopoverOpen(false);
      }
      if (overflowBlockIdx !== null && !target.closest('.wb-overflow-menu') && !target.closest('.wb-cmd-overflow')) {
        setOverflowBlockIdx(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [entitiesOpen, overflowBlockIdx, popoverOpen]);

  // Compute clamped floating popover coordinates inside .wb-app-frame
  const computePopoverStyle = (): React.CSSProperties => {
    const frameW = appFrameRef.current?.clientWidth ?? 900;
    const frameH = appFrameRef.current?.clientHeight ?? 760;
    const popW = 400;
    const popH = 380;
    if (!popoverAnchor) {
      return { left: 24, top: 96 };
    }
    const left = Math.max(12, Math.min(popoverAnchor.left, frameW - popW - 12));
    const belowTop = popoverAnchor.bottom + 8;
    if (belowTop + popH > frameH - 12 && popoverAnchor.top - popH - 8 > 12) {
      return { left, top: popoverAnchor.top - popH - 8 };
    }
    return { left, top: Math.max(56, Math.min(belowTop, frameH - popH - 12)) };
  };

  const popoverStyle = computePopoverStyle();
  const caretLeft = popoverAnchor
    ? Math.max(16, Math.min(popoverAnchor.left + popoverAnchor.width / 2 - Number(popoverStyle.left ?? 24) - 6, 372))
    : 24;
  const showUpwardCaret = popoverAnchor ? Number(popoverStyle.top ?? 96) >= popoverAnchor.bottom : true;

  const handleFrontmatterToggle = (tagWithHash: string) => {
    const view = viewRef.current;
    if (!view) return;
    const change = computeToggleFrontmatterTagChange(view.state.doc, analysis, tagWithHash);
    if (!change) return;
    view.dispatch({ changes: change });
    showToast(`Toggled ${tagWithHash}`);
  };

  const handleCreateAndPickTag = (slug: string, replaceTok?: ParsedToken | null) => {
    const cats = catalogsRef.current;
    if (!cats.tags.some((t) => t.slug === slug)) {
      cats.tags = [{ slug, group: 'Custom', desc: 'Created inline' }, ...cats.tags];
      setCatalogVersion((v) => v + 1);
      viewRef.current?.dispatch({ effects: catalogRefreshEffect.of(Date.now()) });
    }
    if (replaceTok) {
      handleReplaceToken(replaceTok, `#${slug}`);
    } else if (editorMode === 'fm-tag') {
      handleFrontmatterToggle(`#${slug}`);
    } else {
      handleProseFormat(cursorLineNum, 'proseTag', `#${slug}`);
      if (!drawerOpen && !isMobile) setPopoverOpen(false);
    }
  };

  const insertMobileSymbol = (sym: string) => {
    const view = viewRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, to: pos, insert: sym },
      selection: { anchor: pos + sym.length },
      userEvent: 'input.type',
    });
    view.focus();
  };

  const insertMobileNewLineBelow = () => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(cursorLineNum, view.state.doc.lines));
    const indentMatch = /^(\s*)/.exec(line.text);
    const indent = indentMatch ? indentMatch[1] : '';
    view.dispatch({
      changes: { from: line.to, to: line.to, insert: `\n${indent}` },
      selection: { anchor: line.to + 1 + indent.length },
      effects: EditorView.scrollIntoView(line.to + 1 + indent.length, { y: 'nearest' }),
    });
    setActiveTokenId(null);
    setEditorMode('add');
  };

  const indentActiveLine = (delta: -1 | 1) => {
    const view = viewRef.current;
    if (!view || cursorLineNum < 1 || cursorLineNum > view.state.doc.lines) return;
    const line = view.state.doc.line(cursorLineNum);
    if (delta > 0) {
      view.dispatch({ changes: { from: line.from, to: line.from, insert: '  ' } });
    } else {
      const m = /^ {1,2}/.exec(line.text);
      if (m) view.dispatch({ changes: { from: line.from, to: line.from + m[0].length, insert: '' } });
    }
    view.focus();
  };

  const renderEntitySections = () => {
    const { unresolved, tags, efforts, equipment } = analysis.entities;
    return (
      <>
        <div className="wb-sidebar-section">
          <div className="wb-sidebar-heading">
            <span>Unrecognized</span>
            <span className="wb-sidebar-badge is-count">{unresolved.length}</span>
          </div>
          {unresolved.length ? (
            unresolved.map((u) => (
              <button
                key={`${u.lineNum}_${u.raw}`}
                type="button"
                className="wb-sidebar-item"
                onClick={(e) => {
                  setEntitiesOpen(false);
                  jumpToLine(u.lineNum, u.token);
                  openInspectorForMode('token', u.token.id, e.currentTarget);
                }}
              >
                <span className="wb-sidebar-label">
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>{u.raw}</span>
                </span>
                <span className="wb-sidebar-badge is-define">Define</span>
              </button>
            ))
          ) : (
            <div className="wb-editor-desc" style={{ padding: '4px 6px' }}>
              All entities resolved
            </div>
          )}
        </div>

        <div className="wb-sidebar-section">
          <div className="wb-sidebar-heading">
            <span>Tags</span>
            <span className="wb-sidebar-badge is-count">{tags.length}</span>
          </div>
          {tags.length ? (
            tags.map((t) => (
              <button
                key={t}
                type="button"
                className="wb-sidebar-item"
                onClick={() => showToast(`Opened tag ${t}`)}
              >
                <span className="wb-sidebar-label">
                  <Hash size={13} aria-hidden="true" />
                  <span>{t}</span>
                </span>
                <span className="wb-sidebar-badge is-count">Tag</span>
              </button>
            ))
          ) : (
            <div className="wb-editor-desc" style={{ padding: '4px 6px' }}>
              No tags yet
            </div>
          )}
        </div>

        <div className="wb-sidebar-section">
          <div className="wb-sidebar-heading">
            <span>Efforts</span>
            <span className="wb-sidebar-badge is-count">{efforts.length}</span>
          </div>
          {efforts.length ? (
            efforts.map((ef) => (
              <button
                key={ef.id}
                type="button"
                className="wb-sidebar-item"
                onClick={() => showToast(`Opened effort ${ef.name}`)}
              >
                <span className="wb-sidebar-label">
                  <Dumbbell size={13} aria-hidden="true" />
                  <span>{ef.name}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="wb-editor-desc" style={{ padding: '4px 6px' }}>
              No efforts yet
            </div>
          )}
        </div>

        <div className="wb-sidebar-section">
          <div className="wb-sidebar-heading">
            <span>Equipment</span>
            <span className="wb-sidebar-badge is-count">{equipment.length}</span>
          </div>
          {equipment.length ? (
            equipment.map((eq) => (
              <button
                key={eq.id}
                type="button"
                className="wb-sidebar-item"
                onClick={() => showToast(`Opened equipment ${eq.name}`)}
              >
                <span className="wb-sidebar-label">
                  <Wrench size={13} aria-hidden="true" />
                  <span>{eq.name}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="wb-editor-desc" style={{ padding: '4px 6px' }}>
              No equipment inferred
            </div>
          )}
        </div>
      </>
    );
  };

  const renderCompiledTimeline = (blk: DocBlock) => (
    <div className="wb-timeline-list">
      {blk.summary.timeline.length ? (
        blk.summary.timeline.map((item) => {
          const isAct = item.lineNum === cursorLineNum;
          const durTxt =
            item.seconds > 0
              ? `${Math.floor(item.seconds / 60)}:${item.seconds % 60 < 10 ? '0' : ''}${item.seconds % 60}`
              : item.isRest
                ? 'Rest'
                : 'Effort';
          return (
            <button
              key={item.lineNum}
              type="button"
              className={`wb-timeline-row${isAct ? ' is-active' : ''}${item.hasError ? ' is-err' : ''}`}
              onClick={() => jumpToLine(item.lineNum)}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.lineNum}. {item.label}
              </span>
              <span className="wb-timeline-dur wb-tabular">{item.hasError ? 'Error' : durTxt}</span>
            </button>
          );
        })
      ) : (
        <div className="wb-editor-desc">No statements yet — pick a starter template.</div>
      )}
    </div>
  );

  const warnCount = analysis.entities.unresolved.length + analysis.entities.errors.length;

  return (
    <div className="wb-proto-root">
      {/* Prototype Control Toolbar */}
      <nav className="wb-proto-bar" aria-label="Prototype controls">
        <div className="wb-proto-bar-group">
          <Link className="wb-proto-back" to="/playground">
            Playground
          </Link>
          <span className="wb-proto-badge">CodeMirror 6 · Option A + Optional Drawer B</span>
        </div>

        <div className="wb-proto-bar-group">
          <div className="wb-proto-seg" role="group" aria-label="Simulated viewport">
            {(
              [
                { id: 'desktop', label: 'Desktop (1440)' },
                { id: 'tablet', label: 'Tablet (768)' },
                { id: 'mobile', label: 'Mobile (390)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={vp === opt.id ? 'is-active' : undefined}
                data-set-vp={opt.id}
                onClick={() => {
                  setVp(opt.id);
                  setPopoverOpen(false);
                  setOverflowBlockIdx(null);
                  if (opt.id === 'mobile') setMobileDeckOpen(true);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="wb-proto-seg" role="group" aria-label="Scenario preset">
            {Object.values(PROTO_SCENARIOS).map((sc) => (
              <button
                key={sc.id}
                type="button"
                className={scenId === sc.id ? 'is-active' : undefined}
                data-set-scen={sc.id}
                onClick={() => loadScenario(sc.id)}
              >
                {sc.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`wb-proto-k-btn${drawerOpen ? ' is-active' : ''}`}
            aria-pressed={drawerOpen}
            data-wb-toggle-drawer="true"
            onClick={() => {
              setDrawerOpen((prev) => {
                const next = !prev;
                if (next) setPopoverOpen(false);
                return next;
              });
            }}
          >
            <PanelRight size={14} aria-hidden="true" />
            <span>Inspector Drawer</span>
            <span className="wb-kbd-chip">Ctrl+Shift+I</span>
          </button>

          <button
            type="button"
            className="wb-proto-k-btn"
            data-wb-inspect-trigger="true"
            onClick={() => callbacksRef.current.onShortcutInspect()}
          >
            <span>Inspect</span>
            <span className="wb-kbd-chip">Ctrl+.</span>
          </button>
        </div>
      </nav>

      {/* Stage Viewport */}
      <div className="wb-stage-outer">
        <div className="wb-stage-viewport" data-vp={vp}>
          <div
            ref={appFrameRef}
            className="wb-app-frame"
            style={{ '--composer-lift': `${composerLift}px` } as React.CSSProperties}
          >
            <header className="wb-editor-topbar">
              <div className="wb-editor-topbar-left">
                <span className="wb-route-badge">/proto/whiteboard-editor</span>
                <span className="wb-doc-title">{analysis.title}</span>
              </div>
              <div className="wb-topbar-actions">
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary wb-mobile-only-btn"
                  onClick={() => setEntitiesOpen(true)}
                >
                  <span>{warnCount > 0 ? `Entities (${warnCount})` : 'Entities'}</span>
                </button>
                <button
                  type="button"
                  className={`wb-btn ${drawerOpen ? 'wb-btn-primary' : 'wb-btn-secondary'} wb-desktop-only-btn`}
                  aria-pressed={drawerOpen}
                  onClick={() => {
                    setDrawerOpen((prev) => {
                      const next = !prev;
                      if (next) setPopoverOpen(false);
                      return next;
                    });
                  }}
                >
                  <PanelRight size={14} aria-hidden="true" />
                  <span>{drawerOpen ? 'Hide Drawer' : 'Inspector Drawer'}</span>
                </button>
                <button
                  type="button"
                  className="wb-icon-btn"
                  id="wb-btn-undo"
                  aria-label="Undo edit"
                  title="Undo (Ctrl+Z)"
                  disabled={!canUndo}
                  onClick={() => {
                    if (viewRef.current) {
                      undo(viewRef.current);
                      showToast('Undid last change');
                    }
                  }}
                >
                  <Undo2 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="wb-icon-btn"
                  id="wb-btn-redo"
                  aria-label="Redo edit"
                  title="Redo (Ctrl+Y)"
                  disabled={!canRedo}
                  onClick={() => {
                    if (viewRef.current) {
                      redo(viewRef.current);
                      showToast('Redid edit');
                    }
                  }}
                >
                  <Redo2 size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="wb-app-workspace">
              {/* Left Entity Outline */}
              <aside className="wb-entity-sidebar" aria-label="Note entities outline">
                {renderEntitySections()}
              </aside>

              {/* Center Live CodeMirror 6 Document */}
              <div className="wb-app-scroll">
                <main className="wb-note-canvas">
                  <section className="wb-frontmatter-card" aria-label="Note properties">
                    <div className="wb-fm-group">
                      <span className="wb-fm-label">Notebook</span>
                      <span className="wb-fm-pill">{analysis.frontmatter.notebook}</span>
                    </div>
                    <div className="wb-fm-group">
                      <span className="wb-fm-label">Tags</span>
                      {analysis.frontmatter.tags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="wb-fm-pill is-tag"
                          onClick={() => handleFrontmatterToggle(t)}
                        >
                          {t} ×
                        </button>
                      ))}
                      <button
                        type="button"
                        className="wb-fm-pill is-add"
                        onClick={(e) => openInspectorForMode('fm-tag', null, e.currentTarget)}
                      >
                        + Tag
                      </button>
                    </div>
                  </section>

                  {/* Real CodeMirror 6 Mount */}
                  <section className="wb-cm-host" aria-label="Live CodeMirror 6 whiteboard editor">
                    <div ref={editorHostRef} />
                  </section>
                </main>
              </div>

              {/* Optional Option B Right Inspector Drawer (Desktop) */}
              {drawerOpen && !isMobile && !isTablet && (
                <aside className="wb-inspector-drawer" aria-label="Optional inspector drawer">
                  <div className="wb-rail-panel">
                    <div className="wb-rail-head">
                      <span className="wb-rail-title">Focused Token Inspector</span>
                      {lastEditDiff ? (
                        <span className="wb-diff-badge wb-tabular">
                          {lastEditDiff.from} → {lastEditDiff.to}
                        </span>
                      ) : (
                        <span className="wb-kbd-chip">{activeToken?.kind ?? 'ready'}</span>
                      )}
                    </div>
                  </div>

                  <TokenInspectorBody
                    mode={isProseActive && editorMode === 'token' ? 'wiki' : editorMode}
                    token={activeToken}
                    block={activeBlock}
                    catalogs={catalogsRef.current}
                    activeNotebook={analysis.frontmatter.notebook}
                    activeFrontmatterTags={analysis.frontmatter.tags}
                    useScrubber={true}
                    showHeader={true}
                    showFooter={false}
                    showStepButtons={editorMode === 'token'}
                    showClose={false}
                    onReplaceToken={handleReplaceToken}
                    onDeleteToken={handleDeleteToken}
                    onInsertToken={handleInsertToken}
                    onDefineUnresolved={handleDefineUnresolved}
                    onUpdateFence={handleUpdateFence}
                    onInsertTemplate={(tplId) => handleInsertTemplate(activeBlock?.blockIdx ?? 0, tplId)}
                    onPickWiki={(title) => handleProseFormat(cursorLineNum, 'wikiLink', title)}
                    onPickTag={(tag) => {
                      if (editorMode === 'fm-tag') handleFrontmatterToggle(tag);
                      else handleProseFormat(cursorLineNum, 'proseTag', tag);
                    }}
                    onCreateAndPickTag={handleCreateAndPickTag}
                    onStepToken={handleStepToken}
                  />

                  {activeBlock && (
                    <div className="wb-rail-panel">
                      <div className="wb-rail-head">
                        <span className="wb-rail-title">Block Runtime Preview</span>
                        <button
                          type="button"
                          className="wb-inline-link"
                          onClick={() => setEditorMode('block')}
                        >
                          Configure
                        </button>
                      </div>
                      <div className="wb-seg-pills">
                        {(['time', 'log', 'query'] as Dialect[]).map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`wb-choice-pill${activeBlock.dialect === d ? ' is-selected' : ''}`}
                            onClick={() => handleUpdateFence({ dialect: d })}
                          >
                            {d.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      {renderCompiledTimeline(activeBlock)}
                    </div>
                  )}

                  <div className="wb-rail-panel" style={{ borderBottom: 'none' }}>
                    <div className="wb-rail-title">Keyboard Accelerators</div>
                    <div className="wb-shortcut-grid">
                      <div className="wb-shortcut-item">
                        <span>Inspect</span>
                        <span className="wb-kbd-chip">Ctrl+.</span>
                      </div>
                      <div className="wb-shortcut-item">
                        <span>Step value</span>
                        <span className="wb-kbd-chip">Alt+↑/↓</span>
                      </div>
                      <div className="wb-shortcut-item">
                        <span>Tags / Templates</span>
                        <span className="wb-kbd-chip"># /</span>
                      </div>
                      <div className="wb-shortcut-item">
                        <span>Wiki Link</span>
                        <span className="wb-kbd-chip">[[</span>
                      </div>
                    </div>
                  </div>
                </aside>
              )}
            </div>

            {/* Option A Anchored Floating Popover (Desktop & Tablet when Drawer closed) */}
            {popoverOpen && !drawerOpen && !isMobile && (
              <div
                ref={popoverRef}
                className="wb-floating-popover"
                role="dialog"
                aria-label="Token inspector"
                style={popoverStyle}
              >
                {showUpwardCaret && <div className="wb-popover-caret" style={{ left: caretLeft }} />}
                <TokenInspectorBody
                  mode={editorMode}
                  token={activeToken}
                  block={activeBlock}
                  catalogs={catalogsRef.current}
                  activeNotebook={analysis.frontmatter.notebook}
                  activeFrontmatterTags={analysis.frontmatter.tags}
                  useScrubber={false}
                  showHeader={true}
                  showFooter={true}
                  showStepButtons={editorMode === 'token'}
                  showClose={true}
                  onReplaceToken={handleReplaceToken}
                  onDeleteToken={handleDeleteToken}
                  onInsertToken={handleInsertToken}
                  onDefineUnresolved={handleDefineUnresolved}
                  onUpdateFence={handleUpdateFence}
                  onInsertTemplate={(tplId) => handleInsertTemplate(activeBlock?.blockIdx ?? 0, tplId)}
                  onPickWiki={(title) => {
                    handleProseFormat(cursorLineNum, 'wikiLink', title);
                    setPopoverOpen(false);
                    viewRef.current?.focus();
                  }}
                  onPickTag={(tag) => {
                    if (editorMode === 'fm-tag') {
                      handleFrontmatterToggle(tag);
                    } else {
                      handleProseFormat(cursorLineNum, 'proseTag', tag);
                      setPopoverOpen(false);
                      viewRef.current?.focus();
                    }
                  }}
                  onCreateAndPickTag={handleCreateAndPickTag}
                  onStepToken={handleStepToken}
                  onClose={() => {
                    setPopoverOpen(false);
                    viewRef.current?.focus();
                  }}
                />
              </div>
            )}

            {/* Narrow Block Overflow Menu */}
            {overflowBlockIdx !== null && (
              <div
                className="wb-overflow-menu"
                role="dialog"
                aria-label="Block actions"
                style={{ top: overflowPos.top, right: overflowPos.right }}
              >
                {['Shared workout link', 'Added to Today', 'Scheduled'].map((msg) => (
                  <button
                    key={msg}
                    type="button"
                    className="wb-option-row"
                    onClick={() => {
                      setOverflowBlockIdx(null);
                      showToast(msg);
                    }}
                  >
                    <span className="wb-option-title">{msg}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Mobile Unified Bottom Thumb Deck (Option A Rail + Option B Scrubber/Timeline option + 4-button 44px Footer) */}
            {isMobile && mobileDeckOpen && (
              <section ref={mobileDeckRef} className="wb-mobile-deck" aria-label="Mobile whiteboard syntax composer">
                <div className="wb-mobile-deck-rail" role="toolbar" aria-label="Active line tokens">
                  {activeWodEntry ? (
                    <>
                      <button
                        type="button"
                        className={`wb-tok-chip${editorMode === 'block' ? ' is-active' : ''}`}
                        onClick={() => {
                          setEditorMode('block');
                          setMobileTypingMode(false);
                        }}
                      >
                        <SlidersHorizontal size={13} aria-hidden="true" />
                        <span>Block</span>
                      </button>
                      {activeLineTokens.map((tok) => {
                        const chip = tokenChipDescriptor(tok);
                        const sel = editorMode === 'token' && activeToken?.id === tok.id;
                        return (
                          <button
                            key={tok.id}
                            type="button"
                            className={`wb-tok-chip${sel ? ' is-active' : ''}`}
                            data-kind={tok.kind}
                            data-rest={tok.kind === 'duration' && tok.meta.mode === 'rest' ? 'true' : undefined}
                            onClick={() => {
                              setActiveTokenId(tok.id);
                              setEditorMode('token');
                              setMobileTypingMode(false);
                            }}
                          >
                            <span>{chip.text}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`wb-tok-chip is-add${editorMode === 'add' ? ' is-active' : ''}`}
                        onClick={() => {
                          setEditorMode('add');
                          setMobileTypingMode(false);
                        }}
                      >
                        <Plus size={13} aria-hidden="true" />
                        <span>Add</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {(
                        [
                          { kind: 'bold', label: 'Bold' },
                          { kind: 'italic', label: 'Italic' },
                          { kind: 'strike', label: 'Strike' },
                          { kind: 'code', label: 'Code' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.kind}
                          type="button"
                          className="wb-prose-tool-btn"
                          onClick={() => handleProseFormat(cursorLineNum, f.kind)}
                        >
                          <span>{f.label}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`wb-prose-tool-btn${editorMode === 'wiki' ? ' is-active' : ''}`}
                        onClick={() => {
                          setEditorMode('wiki');
                          setMobileTypingMode(false);
                        }}
                      >
                        <span>[[Link]]</span>
                      </button>
                      <button
                        type="button"
                        className={`wb-prose-tool-btn${editorMode === 'prose-tag' ? ' is-active' : ''}`}
                        onClick={() => {
                          setEditorMode('prose-tag');
                          setMobileTypingMode(false);
                        }}
                      >
                        <span>#Tag</span>
                      </button>
                      <button
                        type="button"
                        className="wb-prose-tool-btn"
                        onClick={() => handleProseFormat(cursorLineNum, 'wrapTimeBlock')}
                      >
                        <span>Wrap ```time</span>
                      </button>
                    </>
                  )}
                </div>

                <div className="wb-mobile-deck-body">
                  {mobileTypingMode ? (
                    <>
                      <div className="wb-typing-accessory-row" role="toolbar" aria-label="Syntax symbol keys">
                        {['#', '@', '*', ':', '()', '[[', '|'].map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            className="wb-kbd-key"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertMobileSymbol(sym)}
                          >
                            {sym}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="wb-kbd-key"
                          aria-label="Outdent line"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => indentActiveLine(-1)}
                        >
                          −Tab
                        </button>
                        <button
                          type="button"
                          className="wb-kbd-key"
                          aria-label="Indent line"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => indentActiveLine(1)}
                        >
                          +Tab
                        </button>
                      </div>
                      <div className="wb-editor-desc">
                        Native CodeMirror keyboard active — tap keys above or type directly in the editor; live Token Rail stays visible.
                      </div>
                    </>
                  ) : (
                    <>
                      <TokenInspectorBody
                        mode={isProseActive && editorMode === 'token' ? 'wiki' : editorMode}
                        token={activeToken}
                        block={activeBlock}
                        catalogs={catalogsRef.current}
                        activeNotebook={analysis.frontmatter.notebook}
                        activeFrontmatterTags={analysis.frontmatter.tags}
                        useScrubber={mobileUseScrubber}
                        onToggleScrubber={() => setMobileUseScrubber((prev) => !prev)}
                        showHeader={true}
                        showFooter={false}
                        showStepButtons={false}
                        showClose={false}
                        onReplaceToken={handleReplaceToken}
                        onDeleteToken={handleDeleteToken}
                        onInsertToken={handleInsertToken}
                        onDefineUnresolved={handleDefineUnresolved}
                        onUpdateFence={handleUpdateFence}
                        onInsertTemplate={(tplId) => handleInsertTemplate(activeBlock?.blockIdx ?? 0, tplId)}
                        onPickWiki={(title) => handleProseFormat(cursorLineNum, 'wikiLink', title)}
                        onPickTag={(tag) => {
                          if (editorMode === 'fm-tag') handleFrontmatterToggle(tag);
                          else handleProseFormat(cursorLineNum, 'proseTag', tag);
                        }}
                        onCreateAndPickTag={handleCreateAndPickTag}
                      />
                      {editorMode === 'block' && activeBlock && (
                        <div className="wb-control-section">
                          <div className="wb-control-label">Compiled Timeline</div>
                          {renderCompiledTimeline(activeBlock)}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="wb-mobile-deck-footer">
                  <button
                    type="button"
                    className="wb-btn wb-btn-secondary"
                    disabled={!canUndo}
                    onClick={() => {
                      if (viewRef.current) {
                        undo(viewRef.current);
                        showToast('Undid last change');
                      }
                    }}
                  >
                    <Undo2 size={14} aria-hidden="true" />
                    <span>Undo</span>
                  </button>
                  {activeToken && editorMode === 'token' ? (
                    <button
                      type="button"
                      className="wb-btn wb-btn-danger-soft"
                      onClick={() => handleDeleteToken(activeToken)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  ) : (
                    <button type="button" className="wb-btn wb-btn-secondary" onClick={insertMobileNewLineBelow}>
                      <Layers size={14} aria-hidden="true" />
                      <span>+ Line</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`wb-btn ${mobileTypingMode ? 'wb-btn-primary' : 'wb-btn-secondary'}`}
                    onClick={() => {
                      setMobileTypingMode((prev) => {
                        const next = !prev;
                        if (next) {
                          window.setTimeout(() => viewRef.current?.focus(), 20);
                        }
                        return next;
                      });
                    }}
                  >
                    <Keyboard size={14} aria-hidden="true" />
                    <span>{mobileTypingMode ? 'Picker' : 'Type'}</span>
                  </button>
                  <button
                    type="button"
                    className="wb-btn wb-btn-primary"
                    onClick={() => {
                      setMobileDeckOpen(false);
                      setMobileTypingMode(false);
                    }}
                  >
                    <span>Done</span>
                  </button>
                </div>
              </section>
            )}

            {isMobile && !mobileDeckOpen && (
              <button
                type="button"
                className="wb-btn wb-btn-primary wb-reopen-fab"
                onClick={() => setMobileDeckOpen(true)}
              >
                Edit Line
              </button>
            )}

            {/* Mobile & Tablet Entities Sheet */}
            {entitiesOpen && (
              <div
                className="wb-overlay-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="wb-entities-title"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setEntitiesOpen(false);
                }}
              >
                <div className="wb-overlay-dialog">
                  <div className="wb-sheet-header">
                    <h2 className="wb-sheet-title" id="wb-entities-title">
                      Note Entities &amp; Diagnostics
                    </h2>
                    <button
                      type="button"
                      className="wb-icon-btn"
                      aria-label="Close entities"
                      onClick={() => setEntitiesOpen(false)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="wb-sheet-body">{renderEntitySections()}</div>
                </div>
              </div>
            )}

            {toast && (
              <div className="wb-proto-toast" role="status" aria-live="polite">
                <Check size={14} aria-hidden="true" />
                <span>{toast}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
