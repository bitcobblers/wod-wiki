/**
 * Playground Library Page — the database-backed Playground.
 *
 * Uses the shared command palette (Search / Find / Ctrl+/) to search notes in
 * the ACTIVE database and loads the chosen note into the language workbench.
 * Finished runs persist as Sessions via the workbench's `runNote` prop.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCw, Search } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { notePersistence, type INotePersistence } from '@/services/persistence';
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

export function PlaygroundLibraryPage({ persistence = notePersistence }: PlaygroundLibraryPageProps) {
  const { activeName, dataVersion, feed } = useDatabase();
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  /** Bumped on reload so an unchanged note still re-applies to the workbench. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback((entry: HistoryRecord) => {
    setSelected(entry);
    setReloadNonce((n) => n + 1);
    setError(null);
  }, []);

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

  // Command palette data source over the active database notes
  const notesSource = useMemo<PaletteDataSource>(
    () => ({
      id: 'active-db-notes',
      label: `Notes (${activeName})`,
      search: async (query: string): Promise<PaletteItem[]> => {
        const trimmed = query.trim();
        const entries = await persistence.listNotes(trimmed ? { search: trimmed } : {});
        return entries.slice(0, 30).map((entry) => {
          const dateStr = new Date(entry.targetDate).toLocaleDateString();
          // ponytail: sublabel carries preview words so client-side filter keeps body matches.
          const snippet = entry.rawContent ? ` — ${entry.rawContent.replace(/\s+/g, ' ').slice(0, 90)}` : '';
          return {
            id: entry.id,
            label: entry.title,
            sublabel: `${dateStr}${entry.tags.length ? ` · ${entry.tags.join(', ')}` : ''}${snippet}`,
            category: 'Notes',
            type: 'entry' as const,
            payload: entry,
          };
        });
      },
    }),
    [persistence, activeName, dataVersion],
  );

  const openSearchPalette = useCallback(() => {
    void usePaletteStore
      .getState()
      .open({
        placeholder: `Search notes in ${activeName}…`,
        sources: [notesSource],
      })
      .then((res) => {
        if (!res.dismissed && res.item?.payload) {
          handleSelect(res.item.payload as HistoryRecord);
        }
      });
  }, [notesSource, activeName, handleSelect]);

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

        {/* ── Action bar: find note via palette, reload loaded note ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-3 shadow-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSearchPalette}
              disabled={!feed.coreImported}
              data-testid="playground-library-find"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-xs font-mono font-semibold text-foreground shadow-2xs transition-all cursor-pointer disabled:opacity-50"
            >
              <Search className="size-3.5 text-muted-foreground" />
              <span>{feed.status === 'running' ? 'Importing feed…' : !feed.coreImported ? 'Waiting for feed…' : 'Find workout note…'}</span>
              <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-sans">
                Ctrl+/
              </kbd>
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
              No note loaded — click Find or press Ctrl+/ to load a note
            </span>
          )}
        </div>

        {error && (
          <p className="text-xs text-destructive font-mono" data-testid="playground-library-error" role="alert">
            {error}
          </p>
        )}

        {/* ── Workbench: blank until a note is selected; runs persist as sessions ── */}
        <LanguageWorkbench
          key={selected ? `${selected.id}:${reloadNonce}` : 'blank'}
          initialNote={selected?.rawContent}
          runNote={selected ? { id: selected.id, title: selected.title, persistRuns: true } : undefined}
        />
      </div>
    </MemoryRouter>
  );
}
