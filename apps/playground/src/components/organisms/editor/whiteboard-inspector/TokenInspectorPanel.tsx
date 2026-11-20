import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Minus,
  PanelRight,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  addInlineEffortAlias,
  createInlineEffortFromToken,
  createInlineEquipmentFromToken,
  createInlineTagFromSlug,
  parseLineRefs,
  buildLineWithRefs,
} from '@/app/editor/noteEditorServices';
import { catalogueReload } from '@/app/editor/catalogueReload';
import type { NotebookScopeSnapshot } from '@/components/organisms/editor/wheelSources';
import { queryService } from '@/hooks/useCastSignaling';
import { TEST_IDS } from '@/lib/testIds';
import { cn } from '@/lib/utils';
import {
  extractBlockQueries,
  patchBlockQuery,
  WqlComposer,
  type WqlExecutor,
  type WqlSegmentEditRequest,
} from '@bitcobblers/wod-wiki-ui';
import { isFindQuery } from '@bitcobblers/wod-wiki-wql';
import { TokenScrubber, type ScrubberOption } from './TokenScrubber';
import {
  ACTION_CUES,
  DISTANCE_UNITS,
  formatDurationToken,
  formatResistanceToken,
  insertProseTagInView,
  insertProseWikiLinkInView,
  insertTemplateInSectionView,
  insertTokenOnLineInView,
  MASS_UNITS,
  MINUTE_CHOICES,
  parseDistanceToken,
  parseDurationToken,
  parseResistanceToken,
  replaceTokenInView,
  deleteTokenInView,
  RESISTANCE_AMOUNT_CHOICES,
  searchEffortsFromCatalog,
  searchEquipmentFromCatalog,
  searchTagsFromCatalog,
  searchWikiNotesFromStorage,
  SECOND_CHOICES,
  TIMER_MODES,
  updateFenceHeaderInView,
  WORKOUT_TEMPLATES,
  extractBlockTimeline,
  type EditDiffSummary,
  type InspectorMode,
  type InspectorToken,
  type LineInspection,
} from './tokenModel';

export interface TokenInspectorPanelProps {
  view: EditorView | null;
  mode: InspectorMode;
  inspection: LineInspection;
  token: InspectorToken | null;
  scope: NotebookScopeSnapshot;
  docText: string;
  useScrubber?: boolean;
  onToggleScrubber?: () => void;
  compact?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  showStepButtons?: boolean;
  showClose?: boolean;
  showDockButton?: boolean;
  onDockDrawer?: () => void;
  onMutate?: (diff: EditDiffSummary | null, toastMsg: string) => void;
  onModeChange?: (mode: InspectorMode) => void;
  onStepToken?: (delta: -1 | 1) => void;
  onClose?: () => void;
  activeQueryStageId?: string;
  queryStageRequestToken?: number;
}

const CHOICE_BASE =
  'inline-flex items-center justify-center rounded-full border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums';

export const QUERY_SEED_PRESETS = [
  { label: 'Total Reps', val: ':sum{metric:reps} by {week} last 4w | :bar{}' },
  { label: 'Total Volume', val: ':sum{metric:volume} by {week} last 12w | :timeseries{}' },
  { label: 'Weekly TIS', val: ':sum{metric:tis} by {week} last 8w | :timeseries{}' },
  { label: 'Find Sessions', val: ':session{} last 4w' },
  { label: 'Find Notes', val: ':note{tags:benchmark} last 8w' },
] as const;

const QUERY_CHART_STAGES = [
  { label: 'Bar Chart', suffix: '| :bar{}' },
  { label: 'Timeseries', suffix: '| :timeseries{}' },
  { label: 'Table', suffix: '| :table{}' },
  { label: 'No Chart', suffix: '' },
] as const;

function applyQueryChartStage(rawQuery: string, chartSuffix: string): string {
  const base = rawQuery.replace(/\s*\|\s*:(?:bar|timeseries|table|pie)\{[^}]*\}\s*$/i, '').trim();
  const seed = base || ':sum{metric:reps} by {week} last 4w';
  return chartSuffix ? `${seed} ${chartSuffix}` : seed;
}

const YAML_CONFIG_KEY_RE = /^\s*(?:view|limit|title|chart|span|unit|range|groupBy|columns|sort)\s*:/m;

const executeWqlQuery: WqlExecutor = (ast) =>
  isFindQuery(ast) ? queryService.runFind(ast) : queryService.runQuery(ast.raw);

export const TokenInspectorPanel: React.FC<TokenInspectorPanelProps> = ({
  view,
  mode,
  inspection,
  token,
  scope,
  useScrubber = false,
  onToggleScrubber,
  compact = false,
  showHeader = true,
  showFooter = true,
  showStepButtons = false,
  showClose = false,
  showDockButton = false,
  onDockDrawer,
  onMutate,
  onModeChange,
  onStepToken,
  onClose,
  activeQueryStageId,
  queryStageRequestToken,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAliasPicker, setShowAliasPicker] = useState(false);
  const [wikiResults, setWikiResults] = useState<Array<{ noteId: string; title: string; summary: string }>>([]);
  const [pendingAction, setPendingAction] = useState(false);

  const querySection = inspection.section?.type === 'query' ? inspection.section : null;
  const hasQuerySectionRange = Boolean(
    view &&
      querySection &&
      querySection.contentFrom !== undefined &&
      querySection.contentTo !== undefined,
  );
  const rawQueryBody =
    hasQuerySectionRange && view && querySection
      ? view.state.doc.sliceString(querySection.contentFrom!, querySection.contentTo!)
      : inspection.lineText;

  const queryExtraction = useMemo(() => {
    const extracted = extractBlockQueries(rawQueryBody);
    const hasYamlQueryKey = /^\s*query\s*:/m.test(rawQueryBody);
    const hasOtherYamlConfig = YAML_CONFIG_KEY_RE.test(rawQueryBody);
    let currentQuery: string;
    if (hasYamlQueryKey || (extracted.length > 0 && !hasOtherYamlConfig)) {
      currentQuery = extracted[0]?.query ?? '';
    } else if (hasOtherYamlConfig) {
      currentQuery = '';
    } else {
      currentQuery = rawQueryBody.trim();
    }
    return { extracted, hasYamlQueryKey, hasOtherYamlConfig, currentQuery };
  }, [rawQueryBody]);

  const [showQueryPresets, setShowQueryPresets] = useState<boolean>(
    () => !queryExtraction.currentQuery.trim(),
  );
  const currentQueryRef = useRef(queryExtraction.currentQuery);
  currentQueryRef.current = queryExtraction.currentQuery;

  // Reset transient search when switching target token or mode
  useEffect(() => {
    setSearchQuery('');
    setShowAliasPicker(false);
  }, [token?.id, mode]);

  useEffect(() => {
    if (mode === 'query') {
      setShowQueryPresets(!currentQueryRef.current.trim());
    }
  }, [mode, querySection?.id]);

  useEffect(() => {
    if (mode === 'query' && activeQueryStageId === 'wql-metric' && queryStageRequestToken) {
      setShowQueryPresets(true);
    }
  }, [mode, activeQueryStageId, queryStageRequestToken]);

  const querySegmentEditRequest = useMemo<WqlSegmentEditRequest | undefined>(() => {
    if (mode !== 'query' || !queryStageRequestToken || queryStageRequestToken <= 0) return undefined;
    if (activeQueryStageId === 'wql-metric') {
      const trimmed = currentQueryRef.current.trim();
      const isFindLike = /^:(?:session|note|block|effort|notebook|tag|equipment)\b/i.test(trimmed);
      return { type: isFindLike ? 'target' : 'metric', token: queryStageRequestToken };
    }
    if (activeQueryStageId === 'wql-scope') {
      return { type: 'notebook', token: queryStageRequestToken };
    }
    if (activeQueryStageId === 'wql-window') {
      return { type: 'time', token: queryStageRequestToken };
    }
    return undefined;
  }, [mode, activeQueryStageId, queryStageRequestToken]);

  useEffect(() => {
    if (mode !== 'wiki') return;
    let cancelled = false;
    void searchWikiNotesFromStorage(searchQuery).then((items) => {
      if (!cancelled) setWikiResults(items);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, searchQuery]);

  const choiceHeight = compact ? 'min-h-[44px] px-3.5 py-2' : 'min-h-[32px] px-2.5 py-1';
  const rowHeight = compact ? 'min-h-[44px] px-3 py-2' : 'min-h-[36px] px-2.5 py-1.5';

  const commitReplace = (nextRaw: string, toastMsg?: string) => {
    if (!view || !token) return;
    const prevRaw = token.raw;
    const res = replaceTokenInView(view, token, nextRaw);
    if (res.applied) {
      onMutate?.({ from: prevRaw, to: res.nextText }, toastMsg ?? `Updated -> ${res.nextText}`);
    }
  };

  const commitDelete = () => {
    if (!view || !token) return;
    const prevRaw = token.raw;
    if (deleteTokenInView(view, token)) {
      onMutate?.({ from: prevRaw, to: 'removed' }, `Removed ${prevRaw}`);
    }
  };

  const commitInsert = (rawToInsert: string, toastMsg?: string) => {
    if (!view) return;
    const res = insertTokenOnLineInView(view, inspection.lineNum, rawToInsert);
    if (res) {
      onMutate?.({ from: '+ add', to: res.clean }, toastMsg ?? `Added ${res.clean}`);
      onModeChange?.('token');
    }
  };

  const dispatchCatalogueReload = () => {
    if (view) {
      view.dispatch({ effects: [catalogueReload.of(null)] });
    }
  };

  const handleDefineInline = async (kind: 'effort' | 'equipment' | 'tag', raw: string) => {
    if (!raw.trim() || pendingAction) return;
    setPendingAction(true);
    try {
      if (kind === 'tag') {
        const clean = raw.replace(/^#/, '').trim();
        await createInlineTagFromSlug(clean);
        dispatchCatalogueReload();
        onMutate?.({ from: raw, to: `#${clean}` }, `Created tag #${clean}`);
      } else if (kind === 'effort') {
        const created = await createInlineEffortFromToken(raw);
        dispatchCatalogueReload();
        onMutate?.({ from: raw, to: created.label }, `Defined effort "${created.label}"`);
      } else {
        const created = await createInlineEquipmentFromToken(raw);
        dispatchCatalogueReload();
        onMutate?.({ from: raw, to: created.label }, `Defined equipment "${created.label}"`);
      }
    } finally {
      setPendingAction(false);
    }
  };

  const handleLinkAlias = async (targetSlug: string, targetLabel: string, rawToken: string) => {
    if (pendingAction) return;
    setPendingAction(true);
    try {
      await addInlineEffortAlias(targetSlug, rawToken);
      dispatchCatalogueReload();
      if (view && token && parseLineRefs(inspection.lineText).jsonFrom >= 0) {
        const nextLine = buildLineWithRefs(inspection.lineText, { effort: targetSlug });
        view.dispatch({
          changes: { from: inspection.lineFrom, to: inspection.lineTo, insert: nextLine },
          userEvent: 'input.wheel',
        });
      }
      setShowAliasPicker(false);
      onMutate?.({ from: rawToken, to: targetLabel }, `Aliased "${rawToken}" -> ${targetLabel}`);
    } finally {
      setPendingAction(false);
    }
  };

  const filteredEfforts = useMemo(
    () => searchEffortsFromCatalog(searchQuery, scope),
    [searchQuery, scope],
  );
  const filteredEquipment = useMemo(
    () => searchEquipmentFromCatalog(searchQuery),
    [searchQuery],
  );
  const filteredTags = useMemo(
    () => searchTagsFromCatalog(searchQuery),
    [searchQuery],
  );
  const groupedTags = useMemo(() => {
    const map = new Map<string, Array<{ slug: string; category: string }>>();
    for (const item of filteredTags) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [filteredTags]);

  const timelineItems = useMemo(
    () => (view && inspection.section ? extractBlockTimeline(view.state, inspection.section) : []),
    [view, inspection],
  );

  // Header metadata
  let headerTitle = 'Edit Token';
  let headerBadge = token?.raw ?? '';
  let headerDesc = '';

  if (mode === 'block' && inspection.section) {
    const sportSuffix = inspection.section.sport ? `:${inspection.section.sport}` : '';
    headerTitle = 'Timer Block Settings';
    headerBadge = `\`\`\`${inspection.section.type}${sportSuffix}`;
    headerDesc = 'Switch fence dialect (`time` vs `log`) or insert a grammar-verified template.';
  } else if (mode === 'wiki') {
    headerTitle = 'Insert [[Wiki Link]]';
    headerBadge = 'Note Graph';
    headerDesc = 'Link directly to another Note in your workspace.';
  } else if (mode === 'prose-tag') {
    headerTitle = 'Insert #Tag';
    headerBadge = '#taxonomy';
    headerDesc = 'Insert a canonical tag or create a new tag inline.';
  } else if (mode === 'add') {
    headerTitle = 'Add Syntax Element';
    headerBadge = '+ Element';
    headerDesc = 'Append a structured token to the active workout line.';
  } else if (mode === 'markdown') {
    headerTitle = 'Markdown & Blocks';
    headerBadge = `Line ${inspection.lineNum}`;
    headerDesc = 'Insert workout fences, WQL queries, headings, or wiki links.';
  } else if (mode === 'query') {
    headerTitle = 'WQL Query Stage';
    headerBadge = '```query';
    headerDesc = 'Build a WQL query clause without leaving the note.';
  } else if (token) {
    if (token.kind === 'duration') {
      headerTitle = 'Timer & Duration';
      headerDesc = 'Change timer mode without losing duration or surrounding line text.';
    } else if (token.kind === 'rounds') {
      headerTitle = 'Rounds & Structure';
      headerDesc = 'Switch round count, set scheme, ladder, or interval keyword.';
    } else if (token.kind === 'rep') {
      headerTitle = 'Repetitions';
      headerDesc = 'Adjust target rep count with presets or steppers.';
    } else if (token.kind === 'resistance') {
      headerTitle = 'Resistance & Load';
      headerDesc = 'Toggle @ prefix, unit (kg/lb/pood/%), or target load.';
    } else if (token.kind === 'distance') {
      headerTitle = 'Distance & Calories';
      headerDesc = 'Pick standard distances or convert units.';
    } else if (token.kind === 'effort' || token.kind === 'equipment') {
      headerTitle = token.kind === 'effort' ? 'Movement / Effort' : 'Equipment';
      headerDesc = 'Search catalog & aliases — rewrites clean Whiteboard Script text.';
    } else if (token.kind === 'tag') {
      headerTitle = 'Tag (#tag)';
      headerDesc = 'Replace with a workspace tag or create a new tag inline.';
    } else if (token.kind === 'unresolved') {
      headerTitle = token.isTag ? 'Unrecognized Tag' : 'Unrecognized Term';
      headerDesc = token.diagnostic?.message ?? `Define "${token.raw}" in your catalog or replace from suggestions.`;
    } else if (token.kind === 'lintError') {
      headerTitle = 'Syntax Repair';
      headerDesc = token.lintMessage ?? 'Fix invalid Whiteboard Script syntax.';
    } else if (token.kind === 'action') {
      headerTitle = 'Action Cue';
      headerDesc = 'Replace with a structured bracketed timer cue.';
    }
  }

  const renderSearchInput = (placeholder: string, ariaLabel: string) => (
    <div className="relative flex items-center">
      <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 pointer-events-none" aria-hidden="true" />
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          'w-full pl-8 pr-2.5 rounded-md border border-field-border bg-background text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring',
          compact ? 'min-h-[44px]' : 'h-8',
        )}
      />
    </div>
  );

  const renderBody = () => {
    if (mode === 'block' && inspection.section) {
      const sec = inspection.section;
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Block Dialect</span>
            <div className="flex flex-wrap gap-1.5">
              {(['time', 'log'] as const).map((d) => {
                const isSel = sec.type === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      if (view) {
                        updateFenceHeaderInView(view, sec, { dialect: d });
                        onMutate?.({ from: sec.type, to: d }, `Switched block to \`\`\`${d}`);
                      }
                    }}
                    className={cn(
                      CHOICE_BASE,
                      choiceHeight,
                      isSel
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'bg-popover text-foreground border-border hover:bg-muted',
                    )}
                  >
                    {d === 'time' ? 'TIMER (```time)' : 'LOG (```log)'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Insert Starter Template</span>
            <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-0.5">
              {WORKOUT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    if (view && insertTemplateInSectionView(view, sec, tpl.lines)) {
                      onMutate?.({ from: 'block', to: tpl.name }, `Inserted ${tpl.name} template`);
                    }
                  }}
                  className={cn(
                    'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 transition-colors cursor-pointer',
                    rowHeight,
                  )}
                >
                  <span className="min-w-0 flex flex-col">
                    <span className="text-xs font-semibold text-foreground truncate">{tpl.name}</span>
                    <span className="text-[11px] text-muted-foreground truncate">{tpl.desc}</span>
                  </span>
                  <span className="text-[11px] font-mono text-primary shrink-0 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    Insert
                  </span>
                </button>
              ))}
            </div>
          </div>

          {timelineItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Block Statements</span>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                {timelineItems.map((item) => {
                  const isAct = item.lineNum === inspection.lineNum;
                  return (
                    <button
                      key={item.lineNum}
                      type="button"
                      data-testid={TEST_IDS.EDITOR_BLOCK_TIMELINE_ROW}
                      onClick={() => {
                        if (!view) return;
                        const line = view.state.doc.line(item.lineNum);
                        view.dispatch({ selection: { anchor: line.from } });
                        view.focus();
                      }}
                      className={cn(
                        'w-full rounded-md border px-2.5 py-1.5 min-h-[34px] flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer',
                        isAct
                          ? 'bg-primary/10 border-primary text-foreground font-semibold'
                          : 'bg-popover border-border text-foreground hover:bg-muted',
                      )}
                    >
                      <span className="truncate font-mono">{item.label}</span>
                      <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-card border border-border shrink-0">
                        {item.durationLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      );
    }

    if (mode === 'wiki') {
      return (
        <>
          {renderSearchInput('Search workspace notes...', 'Search workspace notes')}
          <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
            {wikiResults.map((note) => (
              <button
                key={note.noteId}
                type="button"
                data-testid={TEST_IDS.EDITOR_WIKI_PICKER_ITEM}
                onClick={() => {
                  if (view && insertProseWikiLinkInView(view, note.title)) {
                    onMutate?.(null, `Linked [[${note.title}]]`);
                  }
                }}
                className={cn(
                  'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                  rowHeight,
                )}
              >
                <span className="min-w-0 flex flex-col">
                  <span className="text-xs font-semibold text-foreground truncate">{note.title}</span>
                  <span className="text-[11px] text-muted-foreground truncate">{note.summary}</span>
                </span>
                <span className="text-[11px] font-mono text-primary shrink-0">[[Link]]</span>
              </button>
            ))}
            {wikiResults.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">
                No matching workspace notes found. Type <code>[[Title]]</code> directly to create a new link.
              </p>
            )}
          </div>
        </>
      );
    }

    if (mode === 'prose-tag') {
      const qClean = searchQuery.trim().replace(/^#/, '');
      const exactExists = filteredTags.some((t) => t.slug.toLowerCase() === qClean.toLowerCase());
      return (
        <>
          {renderSearchInput('Filter or create #tag...', 'Filter or create tag')}
          {qClean && !exactExists && (
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_TAG_BTN}
              onClick={async () => {
                await handleDefineInline('tag', qClean);
                if (view) insertProseTagInView(view, qClean);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold cursor-pointer self-start"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create &amp; insert #{qClean}
            </button>
          )}
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {groupedTags.map(([cat, list]) => (
              <div key={cat} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {cat}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => {
                        if (view && insertProseTagInView(view, t.slug)) {
                          onMutate?.(null, `Inserted #${t.slug}`);
                        }
                      }}
                      className={cn(CHOICE_BASE, choiceHeight, 'bg-popover text-foreground border-border hover:bg-muted font-mono')}
                    >
                      #{t.slug}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (mode === 'markdown') {
      const quickMd = [
        { label: 'Timer Block', sub: '```time', insert: '\n```time\n10:00 EMOM\n  10 Air Squat\n```\n' },
        { label: 'Log Block', sub: '```log', insert: '\n```log\n5x5 Back Squat @100kg\n```\n' },
        { label: 'Query Block', sub: '```query', insert: '\n```query\n:sum{metric:reps} by {week} last 4w | :bar{}\n```\n' },
        { label: 'Task Item', sub: '- [ ]', prefix: '- [ ] ' },
        { label: 'Heading 2', sub: '## Title', prefix: '## ' },
      ];
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            {quickMd.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (!view) return;
                  const line = view.state.doc.line(inspection.lineNum);
                  if (item.insert) {
                    view.dispatch({
                      changes: { from: line.to, to: line.to, insert: item.insert },
                      selection: { anchor: line.to + item.insert.length },
                      userEvent: 'input.wheel',
                    });
                    onMutate?.(null, `Inserted ${item.label}`);
                  } else if (item.prefix) {
                    const stripped = line.text.replace(/^(#{1,6}\s+|-\s+\[[ xX]\]\s+)/, '');
                    const nextLine = `${item.prefix}${stripped}`;
                    view.dispatch({
                      changes: { from: line.from, to: line.to, insert: nextLine },
                      selection: { anchor: line.from + nextLine.length },
                      userEvent: 'input.wheel',
                    });
                    onMutate?.(null, `Applied ${item.label}`);
                  }
                }}
                className={cn(
                  'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                  rowHeight,
                )}
              >
                <span className="text-xs font-semibold text-foreground">{item.label}</span>
                <span className="text-xs font-mono text-muted-foreground">{item.sub}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onModeChange?.('wiki')}
              className={cn(CHOICE_BASE, choiceHeight, 'bg-popover text-foreground border-border hover:bg-muted')}
            >
              [[Wiki Link]]
            </button>
            <button
              type="button"
              onClick={() => onModeChange?.('prose-tag')}
              className={cn(CHOICE_BASE, choiceHeight, 'bg-popover text-foreground border-border hover:bg-muted')}
            >
              #Tag
            </button>
          </div>
        </div>
      );
    }

    if (mode === 'query') {
      const handleWriteQuery = (nextWql: string, toastMsg?: string) => {
        if (!view || nextWql === queryExtraction.currentQuery) return;
        if (hasQuerySectionRange && querySection) {
          let nextBody: string;
          if (
            queryExtraction.extracted.length > 0 &&
            (queryExtraction.hasYamlQueryKey || !queryExtraction.hasOtherYamlConfig)
          ) {
            nextBody = patchBlockQuery(rawQueryBody, nextWql, 0);
          } else if (queryExtraction.hasOtherYamlConfig) {
            const base = rawQueryBody.trimEnd();
            nextBody = base ? `${base}\nquery: ${nextWql}\n` : `query: ${nextWql}\n`;
          } else {
            const base = rawQueryBody.trimEnd();
            nextBody = base
              ? `${base}\n${nextWql}\n`
              : nextWql
                ? `${nextWql}\n`
                : '';
          }
          view.dispatch({
            changes: {
              from: querySection.contentFrom!,
              to: querySection.contentTo!,
              insert: nextBody,
            },
            userEvent: 'input.wheel',
          });
        } else {
          const line = view.state.doc.line(inspection.lineNum);
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: nextWql },
            userEvent: 'input.wheel',
          });
        }
        onMutate?.(
          toastMsg
            ? { from: queryExtraction.currentQuery || 'empty', to: nextWql }
            : null,
          toastMsg ?? 'Updated query',
        );
      };

      return (
        <div className="flex flex-col gap-2.5 min-w-0">
          <WqlComposer
            surface="sheet"
            defaultExpanded
            query={queryExtraction.currentQuery}
            onQueryChange={(nextWql) => handleWriteQuery(nextWql)}
            execute={executeWqlQuery}
            showDiagnostics
            compact={compact}
            segmentEditRequest={querySegmentEditRequest}
          />

          {activeQueryStageId === 'wql-chart' && (
            <div className="flex flex-col gap-1.5 min-w-0 border-t border-border/60 pt-2">
              <span className="text-xs font-semibold text-muted-foreground">Chart stage</span>
              <div className="flex flex-wrap gap-1.5">
                {QUERY_CHART_STAGES.map((stage) => {
                  const candidate = applyQueryChartStage(queryExtraction.currentQuery, stage.suffix);
                  const isActive =
                    stage.suffix === ''
                      ? !/\|\s*:(?:bar|timeseries|table|pie)\{/i.test(queryExtraction.currentQuery)
                      : queryExtraction.currentQuery.toLowerCase().includes(stage.suffix.slice(2).trim().toLowerCase());
                  return (
                    <button
                      key={stage.label}
                      type="button"
                      onClick={() => handleWriteQuery(candidate, `Chart -> ${stage.label}`)}
                      className={cn(
                        CHOICE_BASE,
                        choiceHeight,
                        isActive
                          ? 'bg-primary text-primary-foreground border-primary font-semibold'
                          : 'bg-popover text-foreground border-border hover:bg-muted',
                      )}
                    >
                      {stage.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5 min-w-0 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setShowQueryPresets((prev) => !prev)}
              aria-expanded={showQueryPresets}
              className={cn(
                'inline-flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer',
                compact ? 'min-h-[44px]' : 'min-h-[28px]',
              )}
            >
              <span>Quick-seed presets</span>
              <span className="text-[11px] font-mono">
                {showQueryPresets ? 'Hide' : 'Show'}
              </span>
            </button>
            {showQueryPresets && (
              <div className="grid grid-cols-2 gap-1.5 min-w-0">
                {QUERY_SEED_PRESETS.map((st) => (
                  <button
                    key={st.label}
                    type="button"
                    onClick={() => handleWriteQuery(st.val, `Applied ${st.label}`)}
                    className={cn(
                      'min-w-0 rounded-md border border-border bg-popover hover:bg-muted text-left flex flex-col gap-0.5 cursor-pointer px-2.5 py-1.5',
                      compact ? 'min-h-[44px]' : 'min-h-[36px]',
                    )}
                  >
                    <span className="text-xs font-semibold text-foreground truncate">{st.label}</span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">{st.val}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (mode === 'add' || !token) {
      const massUnit = scope.preferredMassUnit ?? 'kg';
      const distUnit = scope.preferredDistanceUnit ?? 'm';
      const firstEffort = searchEffortsFromCatalog('', scope)[0]?.label ?? 'Kettlebell Swing';
      const firstTag = `#${searchTagsFromCatalog('')[0]?.slug ?? 'emom'}`;
      const inserts: Array<{ id: string; label: string; raw: string; testId?: string }> = [
        { id: 'effort', label: 'Movement / Effort', raw: firstEffort, testId: 'wheel-option-add-effort' },
        { id: 'weight', label: 'Weight / Load', raw: `20${massUnit}`, testId: 'wheel-option-add-weight' },
        { id: 'duration', label: 'Countdown Timer', raw: '1:00' },
        { id: 'rest', label: 'Rest Interval', raw: '*1:00' },
        { id: 'rep', label: 'Reps', raw: '10' },
        { id: 'distance', label: 'Distance', raw: `400${distUnit}` },
        { id: 'rounds', label: 'Rounds', raw: '(3)' },
        { id: 'action', label: 'Action Cue', raw: '[:rest]' },
        { id: 'tag', label: 'Tag (#)', raw: firstTag },
      ];
      return (
        <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
          {inserts.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              onClick={() => commitInsert(item.raw)}
              className={cn(
                'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                rowHeight,
              )}
            >
              <span className="text-xs font-semibold text-foreground">{item.label}</span>
              <span className="text-xs font-mono text-primary font-semibold">{item.raw}</span>
            </button>
          ))}
        </div>
      );
    }

    // ── Token-specific typed inspectors ────────────────────────────────────
    if (token.kind === 'duration') {
      const dm = token.durationMeta ?? parseDurationToken(token.raw);
      const minsVal = String(dm.mins);
      const secsVal = String(dm.secs);
      const prefix = dm.mode === 'rest' ? '*' : dm.mode === 'countup' ? '^' : '';
      const presets =
        dm.mode === 'collectible'
          ? [':?']
          : [
              `${prefix}:20`,
              `${prefix}:30`,
              `${prefix}1:00`,
              `${prefix}2:00`,
              `${prefix}5:00`,
              `${prefix}10:00`,
            ];

      const stepTotalSec = (deltaSec: number) => {
        const nextTotal = Math.max(5, dm.mins * 60 + dm.secs + deltaSec);
        commitReplace(
          formatDurationToken({
            mode: dm.mode === 'collectible' ? 'countdown' : dm.mode,
            mins: Math.floor(nextTotal / 60),
            secs: nextTotal % 60,
          }),
        );
      };

      const minOptions: ScrubberOption[] = MINUTE_CHOICES.map((m) => ({
        id: `min-${m}`,
        label: `${m}m`,
        value: String(m),
      }));
      const secOptsList = SECOND_CHOICES.includes(dm.secs) ? SECOND_CHOICES : [...SECOND_CHOICES, dm.secs].sort((a, b) => a - b);
      const secOptions: ScrubberOption[] = secOptsList.map((s) => ({
        id: `sec-${s}`,
        label: `:${String(s).padStart(2, '0')}`,
        value: String(s),
      }));

      return (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Timer Mode</span>
              {onToggleScrubber && dm.mode !== 'collectible' && (
                <button
                  type="button"
                  data-testid={TEST_IDS.EDITOR_SCRUBBER_TOGGLE_BTN}
                  onClick={onToggleScrubber}
                  className={cn(
                    'inline-flex items-center rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/10 hover:underline cursor-pointer',
                    compact ? 'min-h-[44px]' : 'min-h-[28px]',
                  )}
                >
                  {useScrubber ? 'Use Presets' : 'Use Scrubber'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TIMER_MODES.map((tm) => {
                const isSel = dm.mode === tm.mode;
                const nextRaw =
                  tm.mode === 'collectible'
                    ? ':?'
                    : formatDurationToken({
                        mode: tm.mode,
                        mins: dm.mode === 'collectible' ? 1 : dm.mins,
                        secs: dm.mode === 'collectible' ? 0 : dm.secs,
                      });
                return (
                  <button
                    key={tm.mode}
                    type="button"
                    onClick={() => commitReplace(nextRaw, `Mode -> ${tm.label}`)}
                    className={cn(
                      CHOICE_BASE,
                      choiceHeight,
                      isSel
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'bg-popover text-foreground border-border hover:bg-muted',
                    )}
                  >
                    {tm.label} ({tm.sample})
                  </button>
                );
              })}
            </div>
          </div>

          {dm.mode !== 'collectible' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Quick Presets</span>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => {
                    const isSel = token.raw.trim() === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => commitReplace(p)}
                        className={cn(
                          CHOICE_BASE,
                          choiceHeight,
                          'font-mono',
                          isSel
                            ? 'bg-primary text-primary-foreground border-primary font-semibold'
                            : 'bg-popover text-foreground border-border hover:bg-muted',
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {useScrubber ? (
                <div className="grid grid-cols-2 gap-2">
                  <TokenScrubber
                    label="Minutes"
                    options={minOptions}
                    selectedValue={minsVal}
                    compact={compact}
                    onSelect={(opt) =>
                      commitReplace(
                        formatDurationToken({
                          mode: dm.mode,
                          mins: parseInt(opt.value, 10) || 0,
                          secs: dm.secs,
                        }),
                      )
                    }
                  />
                  <TokenScrubber
                    label="Seconds"
                    options={secOptions}
                    selectedValue={secsVal}
                    compact={compact}
                    onSelect={(opt) =>
                      commitReplace(
                        formatDurationToken({
                          mode: dm.mode,
                          mins: dm.mins,
                          secs: parseInt(opt.value, 10) || 0,
                        }),
                      )
                    }
                  />
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {[-15, -5, 5, 15].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => stepTotalSec(delta)}
                      className={cn(CHOICE_BASE, choiceHeight, 'font-mono bg-popover text-foreground border-border hover:bg-muted rounded-md')}
                    >
                      {delta > 0 ? `+${delta}s` : `${delta}s`}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      );
    }

    if (token.kind === 'rounds') {
      const numMatch = /^\((\d+)\)$/.exec(token.raw.trim());
      const curNum = numMatch ? parseInt(numMatch[1], 10) : null;
      const presets = ['(3)', '(4)', '(5)', '(8)', '(10)', '(21-15-9)', '5x5', 'EMOM', 'AMRAP', 'Tabata'];
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Rounds / Keyword</span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => commitReplace(p)}
                  className={cn(
                    CHOICE_BASE,
                    choiceHeight,
                    'font-mono',
                    token.raw.trim().toUpperCase() === p.toUpperCase()
                      ? 'bg-primary text-primary-foreground border-primary font-semibold'
                      : 'bg-popover text-foreground border-border hover:bg-muted',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {curNum !== null && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => commitReplace(`(${Math.max(1, curNum - 1)})`)}
                className={cn(CHOICE_BASE, choiceHeight, 'rounded-md bg-popover text-foreground border-border hover:bg-muted gap-1')}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" /> 1 Round
              </button>
              <button
                type="button"
                onClick={() => commitReplace(`(${curNum + 1})`)}
                className={cn(CHOICE_BASE, choiceHeight, 'rounded-md bg-popover text-foreground border-border hover:bg-muted gap-1')}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> 1 Round
              </button>
            </div>
          )}
        </>
      );
    }

    if (token.kind === 'rep') {
      const curNum = parseInt(token.raw.replace(/^@/, ''), 10) || 10;
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Common Rep Targets</span>
            <div className="flex flex-wrap gap-1.5">
              {['5', '8', '10', '12', '15', '20', '21', '30'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => commitReplace(r)}
                  className={cn(
                    CHOICE_BASE,
                    choiceHeight,
                    'font-mono',
                    token.raw.trim() === r
                      ? 'bg-primary text-primary-foreground border-primary font-semibold'
                      : 'bg-popover text-foreground border-border hover:bg-muted',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[-5, -1, 1, 5].map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() => commitReplace(String(Math.max(1, curNum + delta)))}
                className={cn(CHOICE_BASE, choiceHeight, 'rounded-md font-mono bg-popover text-foreground border-border hover:bg-muted')}
              >
                {delta > 0 ? `+${delta}` : String(delta)}
              </button>
            ))}
          </div>
        </>
      );
    }

    if (token.kind === 'resistance') {
      const rm = token.resistanceMeta ?? parseResistanceToken(token.raw);
      const amountPool = RESISTANCE_AMOUNT_CHOICES.includes(rm.amount)
        ? RESISTANCE_AMOUNT_CHOICES
        : [rm.amount, ...RESISTANCE_AMOUNT_CHOICES];
      const scrubOptions: ScrubberOption[] = amountPool.map((amt) => ({
        id: `amt-${amt}`,
        label: `${rm.hasAt ? '@' : ''}${amt}${rm.unit}`,
        value: amt,
      }));
      const quickLoads = ['16', '20', '24', '32', '60', '100'];

      return (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => commitReplace(formatResistanceToken({ ...rm, hasAt: !rm.hasAt }))}
              className={cn(
                CHOICE_BASE,
                choiceHeight,
                'font-mono',
                rm.hasAt
                  ? 'bg-primary text-primary-foreground border-primary font-semibold'
                  : 'bg-popover text-foreground border-border hover:bg-muted',
              )}
            >
              {rm.hasAt ? '@ Prefix On' : 'Add @ Prefix'}
            </button>
            <div className="flex flex-wrap gap-1">
              {MASS_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => commitReplace(formatResistanceToken({ ...rm, unit: u }))}
                  className={cn(
                    CHOICE_BASE,
                    choiceHeight,
                    'font-mono',
                    rm.unit === u
                      ? 'bg-primary text-primary-foreground border-primary font-semibold'
                      : 'bg-popover text-foreground border-border hover:bg-muted',
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Load Amount</span>
            {onToggleScrubber && (
              <button
                type="button"
                data-testid={TEST_IDS.EDITOR_SCRUBBER_TOGGLE_BTN}
                onClick={onToggleScrubber}
                className={cn(
                  'inline-flex items-center rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/10 hover:underline cursor-pointer',
                  compact ? 'min-h-[44px]' : 'min-h-[28px]',
                )}
              >
                {useScrubber ? 'Use Presets' : 'Use Scrubber'}
              </button>
            )}
          </div>

          {useScrubber ? (
            <TokenScrubber
              label={`Load (${rm.unit})`}
              options={scrubOptions}
              selectedValue={rm.amount}
              compact={compact}
              testId="wheel-drum-unit-amount"
              onSelect={(opt) =>
                commitReplace(
                  formatResistanceToken({ ...rm, amount: opt.value, altAmount: null }),
                )
              }
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {quickLoads.map((amt) => {
                const candidate = formatResistanceToken({ ...rm, amount: amt, altAmount: null });
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => commitReplace(candidate)}
                    className={cn(
                      CHOICE_BASE,
                      choiceHeight,
                      'font-mono',
                      rm.amount === amt
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'bg-popover text-foreground border-border hover:bg-muted',
                    )}
                  >
                    {candidate}
                  </button>
                );
              })}
            </div>
          )}
        </>
      );
    }

    if (token.kind === 'distance') {
      const dm = token.distanceMeta ?? parseDistanceToken(token.raw);
      const presets = dm.unit === 'cal' ? ['10', '15', '20', '30', '50'] : ['100', '200', '400', '800', '1000', '2000'];
      return (
        <>
          <div className="flex flex-wrap gap-1">
            {DISTANCE_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => commitReplace(`${dm.amount}${u}`)}
                className={cn(
                  CHOICE_BASE,
                  choiceHeight,
                  'font-mono',
                  dm.unit === u
                    ? 'bg-primary text-primary-foreground border-primary font-semibold'
                    : 'bg-popover text-foreground border-border hover:bg-muted',
                )}
              >
                {u}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => commitReplace(`${amt}${dm.unit}`)}
                className={cn(
                  CHOICE_BASE,
                  choiceHeight,
                  'font-mono',
                  dm.amount === amt
                    ? 'bg-primary text-primary-foreground border-primary font-semibold'
                    : 'bg-popover text-foreground border-border hover:bg-muted',
                )}
              >
                {amt}{dm.unit}
              </button>
            ))}
          </div>
        </>
      );
    }

    if (token.kind === 'effort') {
      return (
        <>
          {renderSearchInput('Search movement or alias (e.g. swing, kbs)...', 'Search effort catalog')}
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {filteredEfforts.map((eff) => {
              const isSel = eff.label.toLowerCase() === token.raw.trim().toLowerCase() || eff.slug === token.refSlug;
              return (
                <button
                  key={eff.slug}
                  type="button"
                  onClick={() => commitReplace(eff.label)}
                  className={cn(
                    'w-full rounded-md border text-left flex items-center justify-between gap-2 cursor-pointer',
                    rowHeight,
                    isSel
                      ? 'bg-primary/10 border-primary text-foreground font-semibold'
                      : 'bg-popover border-border text-foreground hover:bg-muted',
                  )}
                >
                  <span className="min-w-0 flex flex-col">
                    <span className="text-xs font-semibold truncate">{eff.label}</span>
                    {eff.aliases.length > 0 && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        Aliases: {eff.aliases.slice(0, 3).join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {eff.scoped ? 'Scoped' : eff.discipline || eff.slug}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      );
    }

    if (token.kind === 'equipment') {
      return (
        <>
          {renderSearchInput('Search equipment...', 'Search equipment catalog')}
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {filteredEquipment.map((eq) => (
              <button
                key={eq.slug}
                type="button"
                onClick={() => commitReplace(eq.label)}
                className={cn(
                  'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                  rowHeight,
                )}
              >
                <span className="text-xs font-semibold text-foreground">{eq.label}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{eq.slug}</span>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (token.kind === 'tag') {
      const qClean = searchQuery.trim().replace(/^#/, '');
      const exactExists = filteredTags.some((t) => t.slug.toLowerCase() === qClean.toLowerCase());
      return (
        <>
          {renderSearchInput('Filter or create #tag...', 'Search or create tag')}
          {qClean && !exactExists && (
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_TAG_BTN}
              onClick={async () => {
                await handleDefineInline('tag', qClean);
                commitReplace(`#${qClean}`);
              }}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold cursor-pointer self-start"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create &amp; apply #{qClean}
            </button>
          )}
          <div className="flex flex-col gap-2 max-h-44 overflow-y-auto">
            {groupedTags.map(([cat, list]) => (
              <div key={cat} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {cat}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((t) => {
                    const isSel = token.raw.trim().toLowerCase() === `#${t.slug}`.toLowerCase();
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        onClick={() => commitReplace(`#${t.slug}`)}
                        className={cn(
                          CHOICE_BASE,
                          choiceHeight,
                          'font-mono',
                          isSel
                            ? 'bg-primary text-primary-foreground border-primary font-semibold'
                            : 'bg-popover text-foreground border-border hover:bg-muted',
                        )}
                      >
                        #{t.slug}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (token.kind === 'action') {
      return (
        <div className="flex flex-col gap-1">
          {ACTION_CUES.map((cue) => (
            <button
              key={cue.code}
              type="button"
              onClick={() => commitReplace(cue.code)}
              className={cn(
                'w-full rounded-md border text-left flex items-center justify-between gap-2 cursor-pointer',
                rowHeight,
                token.raw.trim() === cue.code
                  ? 'bg-primary/10 border-primary text-foreground font-semibold'
                  : 'bg-popover border-border text-foreground hover:bg-muted',
              )}
            >
              <span className="min-w-0 flex flex-col">
                <span className="text-xs font-semibold">{cue.label}</span>
                <span className="text-[11px] text-muted-foreground">{cue.desc}</span>
              </span>
              <span className="text-xs font-mono text-primary font-semibold shrink-0">{cue.code}</span>
            </button>
          ))}
        </div>
      );
    }

    if (token.kind === 'lintError') {
      return (
        <div className="flex flex-col gap-2">
          <div className="p-2.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{token.lintMessage}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(token.lintFixes ?? []).map((fix) => (
              <button
                key={fix}
                type="button"
                data-testid={TEST_IDS.EDITOR_LINT_QUICK_FIX}
                onClick={() => commitReplace(fix, `Fixed -> ${fix}`)}
                className={cn(CHOICE_BASE, choiceHeight, 'bg-primary text-primary-foreground border-primary font-semibold')}
              >
                Fix: {fix}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (token.kind === 'unresolved') {
      if (token.isTag) {
        const cleanSlug = token.raw.replace(/^#/, '').trim();
        return (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_TAG_BTN}
              disabled={pendingAction}
              onClick={() => void handleDefineInline('tag', cleanSlug)}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold cursor-pointer self-start"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create Tag #{cleanSlug}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {searchTagsFromCatalog('').slice(0, 8).map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => commitReplace(`#${t.slug}`)}
                  className={cn(CHOICE_BASE, choiceHeight, 'font-mono bg-popover text-foreground border-border hover:bg-muted')}
                >
                  #{t.slug}
                </button>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-2">
          <div className="p-2 rounded-md border border-warning/40 bg-warning/10 text-warning text-xs flex items-start gap-2">
            <HelpCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{token.diagnostic?.message ?? `"${token.raw}" is not in your catalog yet.`}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_EFFORT_BTN}
              disabled={pendingAction}
              onClick={() => void handleDefineInline('effort', token.raw)}
              className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Effort
            </button>
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_ALIAS_BTN}
              disabled={pendingAction}
              onClick={() => setShowAliasPicker((prev) => !prev)}
              className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-md border border-border bg-popover text-foreground hover:bg-muted text-xs font-medium cursor-pointer"
            >
              + Alias
            </button>
            <button
              type="button"
              data-testid={TEST_IDS.EDITOR_DEFINE_EQUIPMENT_BTN}
              disabled={pendingAction}
              onClick={() => void handleDefineInline('equipment', token.raw)}
              className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-md border border-border bg-popover text-foreground hover:bg-muted text-xs font-medium cursor-pointer"
            >
              + Equipment
            </button>
          </div>

          {showAliasPicker && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
              <span className="text-xs font-semibold text-muted-foreground">Link &quot;{token.raw}&quot; as alias to:</span>
              {renderSearchInput('Search target effort...', 'Search target effort for alias')}
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                {filteredEfforts.slice(0, 12).map((eff) => (
                  <button
                    key={eff.slug}
                    type="button"
                    onClick={() => void handleLinkAlias(eff.slug, eff.label, token.raw)}
                    className={cn(
                      'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                      rowHeight,
                    )}
                  >
                    <span className="text-xs font-semibold text-foreground">{eff.label}</span>
                    <span className="text-[11px] font-mono text-primary">Link alias</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Or replace with existing movement:</span>
            {!showAliasPicker && renderSearchInput('Search known movements...', 'Search known movements')}
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
              {filteredEfforts.slice(0, 6).map((eff) => (
                <button
                  key={eff.slug}
                  type="button"
                  onClick={() => commitReplace(eff.label)}
                  className={cn(
                    'w-full rounded-md border border-border bg-popover hover:bg-muted text-left flex items-center justify-between gap-2 cursor-pointer',
                    rowHeight,
                  )}
                >
                  <span className="text-xs font-semibold text-foreground">{eff.label}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">Replace</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="text-xs text-muted-foreground">
        Token <code className="font-mono text-foreground">{token.raw}</code> can be edited inline in the editor.
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0 min-w-0">
      {showHeader && (
        <div className="px-3 py-2.5 border-b border-border bg-popover/70 flex items-start justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-bold text-foreground tracking-tight">{headerTitle}</span>
              {headerBadge && (
                <span className="font-mono text-[11.5px] font-semibold px-2 py-0.5 rounded bg-muted border border-border text-foreground max-w-[160px] truncate">
                  {headerBadge}
                </span>
              )}
            </div>
            {headerDesc && (
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{headerDesc}</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {token && (
              <button
                type="button"
                aria-label="Delete token"
                data-testid={TEST_IDS.EDITOR_TOKEN_DELETE_BTN}
                onClick={commitDelete}
                className="inline-flex items-center justify-center min-h-[30px] min-w-[30px] rounded-md border border-transparent hover:border-destructive/30 hover:bg-destructive/10 text-destructive transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {showStepButtons && onStepToken && (
              <>
                <button
                  type="button"
                  aria-label="Previous token"
                  data-testid={TEST_IDS.EDITOR_TOKEN_PREV_BTN}
                  onClick={() => onStepToken(-1)}
                  className="inline-flex items-center justify-center min-h-[30px] min-w-[30px] rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next token"
                  data-testid={TEST_IDS.EDITOR_TOKEN_NEXT_BTN}
                  onClick={() => onStepToken(1)}
                  className="inline-flex items-center justify-center min-h-[30px] min-w-[30px] rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
            {showDockButton && onDockDrawer && (
              <button
                type="button"
                aria-label="Dock inspector drawer"
                title="Open Option B Right Inspector Drawer (Ctrl+Alt+I / Cmd+Alt+I)"
                onClick={onDockDrawer}
                className="inline-flex items-center justify-center min-h-[30px] min-w-[30px] rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <PanelRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {showClose && onClose && (
              <button
                type="button"
                aria-label="Close inspector"
                onClick={onClose}
                className="inline-flex items-center justify-center min-h-[30px] min-w-[30px] rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex flex-col gap-3 min-h-0 min-w-0',
          showFooter ? 'p-3 overflow-y-auto max-h-[380px]' : compact ? 'py-1' : 'p-3',
        )}
      >
        {renderBody()}
      </div>

      {showFooter && (
        <div className="px-3 py-2 border-t border-border bg-popover/70 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground shrink-0">
          <span>Line-safe transaction</span>
          <span>Esc closes inspector</span>
        </div>
      )}
    </div>
  );
};
