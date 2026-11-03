/**
 * Playground Library Page — the database-backed Playground.
 *
 * Combines:
 * 1. An interactive WQL & Notebook Side-Loader Drawer (using the exact same
 *    `WqlComposer` + `queryService.runFind` pipeline as `WqlLibrarySearchPage`,
 *    plus Notebook category filter pills and a Runnable-Workouts-Only toggle),
 * 2. The shared Command Palette (`Find workout note…` / `Ctrl+/`) with both
 *    plain-text and WQL query support (`:note{...}`, `:block{...}`) and
 *    runnable-workout prioritization,
 * 3. Live loading into `LanguageWorkbench` where finished runs persist as
 *    Sessions in the active IndexedDB database via `runNote`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Play, RotateCw, Search } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import {
  isFindQuery,
  notebookOfItem,
  parseQuery,
  type FindQueryResult,
} from '@bitcobblers/wod-wiki-engine';
import { WqlComposer } from '@bitcobblers/wod-wiki-ui';
import { notePersistence, type INotePersistence } from '@/services/persistence';
import { queryService } from '@/services/queryService';
import { formatDateMedium } from '@/lib/dateFormat';
import type { PaletteDataSource, PaletteItem } from '@/components/organisms/command-palette/palette-types';
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store';
import { PaletteShell } from '@/components/organisms/command-palette/PaletteShell';
import type { HistoryRecord } from '@/types/history';
import { useDatabase } from '../database/DatabaseContext';
import { LanguageWorkbench } from '../workbench/LanguageWorkbench';

export interface PlaygroundLibraryPageProps {
  /** Injectable persistence seam (defaults to the active-database singleton). */
  persistence?: INotePersistence;
}

const DEFAULT_WQL = ':note{}';

/** True when the note markdown contains at least one runnable `time` or `log` fence. */
export function hasRunnableFence(rawContent?: string): boolean {
  if (!rawContent) return false;
  return /```(?:time|log)\b/i.test(rawContent);
}

/** Readable notebook badge from a note's resolved `notebook/<slug>` identity. */
export function notebookLabelForNote(note: {
  id?: string;
  sourceId?: string;
  notebookId?: string;
  sourcePath?: string;
  type?: string;
  tags?: readonly string[];
}): string {
  const nb = notebookOfItem(note);
  if (!nb) return 'general';
  return nb.replace(/^notebook\//, '');
}

/** Sort runnable workout notes ahead of reference/effort definitions, then alphabetically. */
export function sortNotesRunnableFirst<T extends { title: string; rawContent?: string; type?: string }>(
  notes: readonly T[],
): T[] {
  return [...notes].sort((a, b) => {
    const aRunnable = hasRunnableFence(a.rawContent) ? 1 : 0;
    const bRunnable = hasRunnableFence(b.rawContent) ? 1 : 0;
    if (aRunnable !== bRunnable) return bRunnable - aRunnable;
    const aEffort = a.type === 'effort' || /type:\s*effort\b/i.test(a.rawContent ?? '') ? 1 : 0;
    const bEffort = b.type === 'effort' || /type:\s*effort\b/i.test(b.rawContent ?? '') ? 1 : 0;
    if (aEffort !== bEffort) return aEffort - bEffort;
    return a.title.localeCompare(b.title);
  });
}

export function PlaygroundLibraryPage({ persistence = notePersistence }: PlaygroundLibraryPageProps) {
  const { activeName, dataVersion, feed, feedSources, importFeedSource } = useDatabase();
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  /** Bumped on reload so an unchanged note still re-applies to the workbench. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Inline WQL & Notebook Side-Loader state ──
  const [browserOpen, setBrowserOpen] = useState(true);
  const [wqlDraft, setWqlDraft] = useState(DEFAULT_WQL);
  const [textFilter, setTextFilter] = useState('');
  const [activeNotebook, setActiveNotebook] = useState<string>('all');
  const [onlyRunnable, setOnlyRunnable] = useState(true);
  const [wqlResult, setWqlResult] = useState<FindQueryResult | null>(null);
  const [wqlRunning, setWqlRunning] = useState(false);
  const [wqlError, setWqlError] = useState<string | null>(null);

  const runWqlSearch = useCallback(async (wql: string) => {
    const parsed = parseQuery(wql);
    if (parsed.error || !isFindQuery(parsed)) return;
    setWqlRunning(true);
    setWqlError(null);
    try {
      setWqlResult(await queryService.runFind(parsed));
    } catch (e) {
      setWqlResult(null);
      setWqlError(e instanceof Error ? e.message : String(e));
    } finally {
      setWqlRunning(false);
    }
  }, []);

  // Re-run the active WQL query whenever the database content changes (feed import or DB switch)
  useEffect(() => {
    void runWqlSearch(wqlDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runWqlSearch, dataVersion]);

  const handleSelect = useCallback((entry: HistoryRecord) => {
    setSelected(entry);
    setReloadNonce((n) => n + 1);
    setError(null);
  }, []);

  const handleSelectNoteRow = useCallback(
    (note: { id: string; title: string; rawContent: string; createdAt: number; date?: number; tags?: string[] }) => {
      persistence
        .getNote(note.id)
        .then((record) => {
          handleSelect(record);
        })
        .catch(() => {
          // Fallback to constructing a HistoryRecord directly from the WQL Note row
          handleSelect({
            id: note.id,
            title: note.title,
            rawContent: note.rawContent,
            createdAt: note.createdAt,
            updatedAt: note.createdAt,
            targetDate: note.date ?? note.createdAt,
            tags: note.tags ?? [],
            type: 'note',
            schemaVersion: 1,
          });
        });
    },
    [persistence, handleSelect],
  );

  const handleReload = useCallback(() => {
    if (!selected) return;
    persistence
      .getNote(selected.id)
      .then((note) => {
        if (!note) throw new Error('The note is no longer in the database.');
        setSelected((prev) => (prev ? { ...prev, rawContent: note.rawContent, title: note.title } : prev));
        setReloadNonce((n) => n + 1);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [persistence, selected]);

  // Notebook facets derived from the current WQL result set
  const notebookCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of wqlResult?.notes ?? []) {
      if (onlyRunnable && !hasRunnableFence(note.rawContent)) continue;
      const nb = notebookLabelForNote(note);
      counts.set(nb, (counts.get(nb) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [wqlResult, onlyRunnable]);

  const filteredNotes = useMemo(() => {
    const rawNotes = wqlResult?.notes ?? [];
    const q = textFilter.trim().toLowerCase();
    const filtered = rawNotes.filter((note) => {
      if (onlyRunnable && !hasRunnableFence(note.rawContent)) return false;
      if (activeNotebook !== 'all' && notebookLabelForNote(note) !== activeNotebook) return false;
      if (!q) return true;
      return (
        note.title.toLowerCase().includes(q) ||
        note.rawContent.toLowerCase().includes(q) ||
        (note.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
    return sortNotesRunnableFirst(filtered);
  }, [wqlResult, onlyRunnable, activeNotebook, textFilter]);

  // Command palette data source over the active database notes (supports both plain text & WQL `:note{...}`)
  const notesSource = useMemo<PaletteDataSource>(
    () => ({
      id: 'active-db-notes',
      label: `Notes (${activeName})`,
      search: async (query: string, context?: { scopeWql?: string }): Promise<PaletteItem[]> => {
        const trimmed = query.trim();
        let entries: HistoryRecord[];

        const parsed = parseQuery(trimmed);
        if (!parsed.error && isFindQuery(parsed)) {
          const res = await queryService.runFind(parsed);
          entries = res.notes.map((n) => ({
            id: n.id,
            title: n.title,
            rawContent: n.rawContent,
            createdAt: n.createdAt,
            updatedAt: n.createdAt,
            targetDate: n.date ?? n.createdAt,
            tags: n.tags ?? [],
            type: (n.type as HistoryRecord['type']) ?? 'note',
            sourceId: n.sourceId,
            notebookId: n.notebookId,
            schemaVersion: 1,
          }));
        } else if (trimmed.startsWith(':')) {
          // Mid-edit WQL — keep results or fallback to scope
          const scopeParsed = parseQuery(context?.scopeWql ?? DEFAULT_WQL);
          if (!scopeParsed.error && isFindQuery(scopeParsed)) {
            const res = await queryService.runFind(scopeParsed);
            entries = res.notes.map((n) => ({
              id: n.id,
              title: n.title,
              rawContent: n.rawContent,
              createdAt: n.createdAt,
              updatedAt: n.createdAt,
              targetDate: n.date ?? n.createdAt,
              tags: n.tags ?? [],
              type: (n.type as HistoryRecord['type']) ?? 'note',
              sourceId: n.sourceId,
              notebookId: n.notebookId,
              schemaVersion: 1,
            }));
          } else {
            entries = await persistence.listNotes({});
          }
        } else {
          entries = await persistence.listNotes(trimmed ? { search: trimmed } : {});
        }
        const prioritized = sortNotesRunnableFirst(entries);
        return prioritized.slice(0, 60).map((entry) => {
          const dateStr = new Date(entry.targetDate).toLocaleDateString();
          const nb = notebookLabelForNote(entry);
          const runnable = hasRunnableFence(entry.rawContent);
          // Include full matching context so CommandListView's client-side filter never drops a body match
          const flatBody = entry.rawContent ? entry.rawContent.replace(/\s+/g, ' ') : '';
          let snippet = flatBody ? ` — ${flatBody.slice(0, 90)}` : '';
          if (trimmed && !trimmed.startsWith(':') && flatBody) {
            const matchIdx = flatBody.toLowerCase().indexOf(trimmed.toLowerCase());
            if (matchIdx > 60) {
              const start = Math.max(0, matchIdx - 20);
              snippet = ` — …${flatBody.slice(start, start + 90)}`;
            }
          }
          return {
            id: entry.id,
            label: entry.title,
            sublabel: `${nb} · ${dateStr}${entry.tags.length ? ` · ${entry.tags.join(', ')}` : ''}${snippet}`,
            category: runnable ? `Workout Notes (${nb})` : `Reference Notes (${nb})`,
            type: 'entry' as const,
            payload: entry,
          };
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistence, activeName, dataVersion],
  );

  const openSearchPalette = useCallback(() => {
    void usePaletteStore
      .getState()
      .open({
        placeholder: `Search notes in ${activeName}…`,
        wql: {
          initialQuery: wqlDraft || DEFAULT_WQL,
          execute: (ast) =>
            isFindQuery(ast) ? queryService.runFind(ast) : queryService.runQuery(ast.raw),
          onApply: (nextWql) => {
            setWqlDraft(nextWql);
            void runWqlSearch(nextWql);
          },
        },
        sources: [notesSource],
      })
      .then((res) => {
        if (!res.dismissed && res.item?.payload) {
          handleSelect(res.item.payload as HistoryRecord);
        }
      });
  }, [notesSource, activeName, wqlDraft, runWqlSearch, handleSelect]);

  // Global Ctrl+/ and Cmd+/ hotkey: opens the command palette anywhere on the page
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        openSearchPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [openSearchPalette]);

  return (
    <MemoryRouter>
      <div className="flex flex-col gap-4" data-testid="playground-library-page">
        {/* Command palette overlay host */}
        <PaletteShell />

        {/* ── Action bar: find note via palette, toggle side-loader browser, reload loaded note ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openSearchPalette}
              disabled={!feed.coreImported}
              data-testid="playground-library-find"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-mono font-semibold text-foreground shadow-2xs transition-all cursor-pointer disabled:opacity-50"
            >
              <Search className="size-3.5 text-muted-foreground" />
              <span>
                {feed.status === 'running'
                  ? 'Importing feed…'
                  : !feed.coreImported
                    ? 'Waiting for feed…'
                    : 'Find workout note…'}
              </span>
              <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-sans">
                Ctrl+/
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => setBrowserOpen((v) => !v)}
              data-testid="playground-library-toggle-drawer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-mono font-semibold text-foreground shadow-2xs transition-all cursor-pointer"
            >
              <BookOpen className="size-3.5 text-primary" />
              <span>Notebook &amp; WQL Side-Loader ({filteredNotes.length})</span>
              {browserOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>

            {selected && (
              <button
                type="button"
                onClick={handleReload}
                data-testid="playground-library-reload"
                title="Re-read the selected note from the active database"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-mono font-semibold text-foreground shadow-2xs transition-all cursor-pointer"
              >
                <RotateCw className="size-3.5" />
                <span>Reload</span>
              </button>
            )}
          </div>

          {selected ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="playground-library-selected">
              <span className="text-[11px] font-mono text-muted-foreground">Active note:</span>
              <span className="text-xs font-bold font-mono text-primary">{selected.title}</span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {new Date(selected.targetDate).toLocaleDateString()}
              </span>
              {selected.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs font-mono text-muted-foreground">
              No note loaded — select a workout from the Notebook &amp; WQL browser below or press Ctrl+/
            </span>
          )}
        </div>

        {/* ── Collapsible WQL & Notebook Side-Loader Browser ── */}
        {browserOpen && (
          <section
            className="rounded-xl border border-border/70 bg-card/50 p-4 flex flex-col gap-3 shadow-xs"
            data-testid="playground-library-browser"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Database Notebook &amp; WQL Side-Loader ({activeName})
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Query notes in the active IndexedDB with WQL or filter by Notebook, then click any row to side-load it into the Workbench below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyRunnable}
                    onChange={(e) => setOnlyRunnable(e.target.checked)}
                    data-testid="playground-library-runnable-only"
                    className="rounded border-border"
                  />
                  <span>Runnable workouts only (`time`/`log` fences)</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
              <div className="lg:col-span-2">
                <WqlComposer
                  initialQuery={DEFAULT_WQL}
                  query={wqlDraft}
                  onQueryChange={(next) => {
                    setWqlDraft(next);
                    const parsed = parseQuery(next);
                    if (!parsed.error && isFindQuery(parsed)) {
                      void runWqlSearch(next);
                    }
                  }}
                  onSubmit={(wql) => void runWqlSearch(wql)}
                  actionLabel="Run"
                  placeholder=":note{tags:benchmark}"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    placeholder="Filter title, movement, or script text…"
                    data-testid="playground-library-text-filter"
                    className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                {wqlResult && (
                  <span className="font-mono text-[10px] text-muted-foreground px-1">
                    {wqlRunning
                      ? 'Querying database…'
                      : `Showing ${filteredNotes.length} of ${wqlResult.notes.length} matched notes (selected ${wqlResult.stages.selected})`}
                  </span>
                )}
              </div>
            </div>

            {/* Notebook category filter pills */}
            {notebookCounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="playground-library-notebooks">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
                  Notebooks:
                </span>
                <button
                  type="button"
                  onClick={() => setActiveNotebook('all')}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono cursor-pointer transition-colors ${
                    activeNotebook === 'all'
                      ? 'border-primary bg-primary/10 text-primary font-bold'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({notebookCounts.reduce((acc, [, n]) => acc + n, 0)})
                </button>
                {notebookCounts.map(([nb, count]) => (
                  <button
                    key={nb}
                    type="button"
                    onClick={() => setActiveNotebook(nb)}
                    data-testid={`playground-notebook-pill-${nb}`}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-mono cursor-pointer transition-colors ${
                      activeNotebook === nb
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {nb} ({count})
                  </button>
                ))}
              </div>
            )}

            {/* Community Feed Sources — one-click import into the active database */}
            <div className="flex flex-wrap items-center gap-1.5" data-testid="playground-library-feed-sources">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
                Import Feed Libraries:
              </span>
              {feedSources
                .filter((src) => src.id !== 'core')
                .slice(0, 8)
                .map((src) => (
                  <button
                    key={src.id}
                    type="button"
                    disabled={feed.status === 'running'}
                    onClick={() => void importFeedSource(src.id)}
                    data-testid={`playground-import-feed-${src.id}`}
                    title={src.description ?? `Import ${src.label} feed into ${activeName}`}
                    className="rounded-md border border-border/80 bg-background hover:bg-accent px-2 py-0.5 text-[10px] font-mono text-foreground cursor-pointer transition-colors disabled:opacity-50"
                  >
                    ＋ {src.label}
                  </button>
                ))}
              {feed.status === 'running' && (
                <span className="text-[10px] font-mono text-primary animate-pulse ml-1">
                  Syncing feed into {activeName}…
                </span>
              )}
            </div>

            {wqlError && (
              <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
                {wqlError}
              </div>
            )}

            {/* Scrollable note list — click any row to side-load into Workbench */}
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background/80 divide-y divide-border/50">
              {filteredNotes.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center font-mono">
                  {wqlRunning
                    ? 'Loading notes from database…'
                    : 'No matching notes in the active database. Try unchecking "Runnable workouts only" or clearing filters.'}
                </p>
              ) : (
                filteredNotes.slice(0, 80).map((note) => {
                  const isActive = selected?.id === note.id;
                  const nb = notebookLabelForNote(note);
                  const runnable = hasRunnableFence(note.rawContent);
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => handleSelectNoteRow(note)}
                      data-testid="playground-library-note-row"
                      className={`w-full text-left flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                        isActive ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted/60 text-foreground'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium text-primary truncate">{note.title}</span>
                        <span className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {nb}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateMedium(new Date(note.date ?? note.createdAt))}
                        </span>
                        {note.tags && note.tags.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {note.tags.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                #{tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-primary shrink-0">
                        <Play className="size-2.5" />
                        <span>{isActive ? 'Loaded' : runnable ? 'Load Workout' : 'Load Note'}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {error && (
          <p className="text-xs text-destructive font-mono" data-testid="playground-library-error" role="alert">
            {error}
          </p>
        )}

        {/* ── Workbench: loads selected note; finished runs persist as sessions ── */}
        <LanguageWorkbench
          key={selected ? `${selected.id}:${reloadNonce}` : 'blank'}
          initialNote={selected?.rawContent}
          runNote={selected ? { id: selected.id, title: selected.title, persistRuns: true } : undefined}
        />
      </div>
    </MemoryRouter>
  );
}
