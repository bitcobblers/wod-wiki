export { constructSource } from './constructSource';
export type { ConstructItem } from './constructSource';

import type { PaletteDataSource, PaletteItem } from '@/components/organisms/command-palette/palette-types';
import { storageService } from '@/services/storage';
import { notePersistence } from '@/services/persistence';
import { normalizeNoteTitle } from '@/lib/noteTitle';
import { playgroundContent } from './playgroundContent';
import { formatDateMedium, formatDateShort } from '@/lib/dateFormat';
import type { CanvasRoute } from '../canvas/canvasRoutes';
import type { ScriptNotebook } from '@/repositories/script-notebooks';
import type { WorkoutItem } from '../lib/workoutIndex';

// ── Global search ─────────────────────────────────────────────────────────

/**
 * Lists canvas route pages. Standalone so the WQL-driven global palette
 * (issue #834) can combine it with WQL results; `globalSearchSource`
 * delegates to it.
 */
export function canvasRouteSource(canvasRoutes: CanvasRoute[]): PaletteDataSource {
  return {
    id: 'canvas-routes',
    label: 'Pages',
    search: (query) => {
      const low = query.toLowerCase();
      return canvasRoutes
        .filter(r => {
          const title = r.page.sections[0]?.heading ?? r.route;
          return !low || title.toLowerCase().includes(low) || r.route.toLowerCase().includes(low);
        })
        .slice(0, 5)
        .map(r => {
          const title = r.page.sections[0]?.heading ?? r.route;
          return {
            id: `route:${r.route}`,
            label: title,
            sublabel: r.route,
            category: 'Pages',
            type: 'route' as const,
            payload: { route: r.route },
          };
        });
    },
  };
}

/**
 * Searches canvas pages, workout library items, and recent IndexedDB results.
 * Used for Ctrl+/ global search.
 */
export function globalSearchSource(
  items: WorkoutItem[],
  canvasRoutes?: CanvasRoute[],
  showPlaygrounds = false,
): PaletteDataSource {
  return {
    id: 'global-search',
    label: 'Search',
    search: async (query) => {
      const results: PaletteItem[] = [];
      const low = query.toLowerCase();

      // Canvas route pages
      if (canvasRoutes?.length) {
        results.push(...await canvasRouteSource(canvasRoutes).search(query));
      }

      // Workout library
      items
        .filter(item =>
          !item.searchHidden &&
          (!low ||
            item.name.toLowerCase().includes(low) ||
            item.category.toLowerCase().includes(low))
        )
        .slice(0, 10)
        .forEach(item => {
          results.push({
            id: item.id,
            label: item.name,
            sublabel: item.category,
            category: item.category,
            type: 'workout',
            payload: item,
          });
        });

      // Recent IndexedDB sessions. IndexedDB failures propagate to the
      // palette shell, which already handles and reports search errors.
      const recent = await storageService.getRecentSessions(50);
      const noteIds = [...new Set(recent.map(r => r.noteId))];
      const notes = noteIds.length > 0
        ? await notePersistence.listNotes({ ids: noteIds, projection: 'summary' }).catch(() => [])
        : [];
      const titleByNoteId = new Map(notes.map(n => [n.id, normalizeNoteTitle(n.title)]));

      recent
        .filter(r => {
          const isPlayground = r.origin
            ? r.origin === 'playground'
            : r.noteId.startsWith('playground/');
          if (isPlayground && !showPlaygrounds) return false;
          const title = titleByNoteId.get(r.noteId) ?? '';
          const fallbackName = r.noteId.split('/').pop()?.toLowerCase() ?? '';
          const searchText = title || fallbackName;
          return !low || searchText.includes(low) || r.id.toLowerCase().includes(low) || r.noteId.toLowerCase().includes(low);
        })
        .slice(0, 5)
        .forEach(r => {
          const date = formatDateMedium(new Date(r.createdAt));
          const status = r.data?.completed ? 'Completed' : 'Partial';
          const fallbackLabel = `${date} · ${status}`;
          const title = titleByNoteId.get(r.noteId) ?? '';
          const label = title || fallbackLabel;
          results.push({
            id: r.id,
            label,
            sublabel: title ? fallbackLabel : undefined,
            category: 'Recent',
            type: 'journal-entry',
            payload: r,
          });
        });
      return results;
    },
  };
}

// ── WOD block source (for statement builder) ───────────────────────────────

export type { SegmentType } from '@/components/organisms/command-palette/segmentSources';
export { segmentSource } from '@/components/organisms/command-palette/segmentSources';

// ── Notebook drill-down sources ─────────────────────────────────────────────

/**
 * Lists every notebook in the seeded corpus as a selectable item.
 * Payload: ScriptNotebook
 */
export function notebookListSource(): PaletteDataSource {
  return {
    id: 'notebook-list',
    label: 'Notebooks',
    search: async (query) => {
      // Dynamic import by design: the palette loads early — keep the
      // repository → seed-content → storage chain out of its static graph.
      const { getScriptNotebooks } = await import('@/repositories/script-notebooks');
      const notebooks = await getScriptNotebooks();
      const low = query.toLowerCase();
      return notebooks
        .filter(n => !low || n.name.toLowerCase().includes(low) || n.id.toLowerCase().includes(low))
        .map(n => ({
          id: n.id,
          label: n.name,
          sublabel: `${n.items.length} note${n.items.length !== 1 ? 's' : ''}`,
          category: 'Notebooks',
          type: 'notebook' as const,
          payload: n,
        }));
    },
  };
}

/**
 * Lists notes within a single ScriptNotebook.
 * Payload: ScriptNotebookItem
 */
export function notebookItemsSource(notebook: ScriptNotebook): PaletteDataSource {
  return {
    id: `notebook-items:${notebook.id}`,
    label: notebook.name,
    search: async (query) => {
      const low = query.toLowerCase();
      return notebook.items
        .filter(item =>
          !low ||
          item.name.toLowerCase().includes(low) ||
          item.id.toLowerCase().includes(low)
        )
        .map(item => ({
          id: item.path,
          label: item.date ? `${item.name} — ${item.date}` : item.name,
          sublabel: notebook.name,
          category: notebook.name,
          type: 'workout' as const,
          payload: item,
        }));
    },
  };
}

// ── WOD block extraction ──────────────────────────────────────────────────

export interface ExtractedScriptBlock {
  index: number;
  /** The raw wod/log/plan script inside the fence */
  script: string;
  preview: string;
  /** The fence tag: time | log */
  dialect: 'time' | 'log';
}

/**
 * Pull every ```time / ```log fenced block out of a markdown string.
 */
export function extractScriptBlocks(markdown: string): ExtractedScriptBlock[] {
  const blocks: ExtractedScriptBlock[] = [];
  const re = /```(time|log)(:\w+)?\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(markdown)) !== null) {
    const dialect = match[1].toLowerCase() as ExtractedScriptBlock['dialect'];
    const script = match[3];
    const preview = script.split('\n').find(l => l.trim())?.trim() ?? '(empty block)';
    blocks.push({ index: index++, script, preview, dialect });
  }
  return blocks;
}

/**
 * Lists extracted WOD blocks from a workout's markdown content.
 * Returns a single "whole workout" option when there is only one block.
 * Payload: ExtractedScriptBlock
 */
export function scriptBlockSource(
  workoutName: string,
  markdown: string
): PaletteDataSource {
  const blocks = extractScriptBlocks(markdown);
  return {
    id: `wod-blocks:${workoutName}`,
    label: 'WOD Blocks',
    search: async (query) => {
      const low = query.toLowerCase();
      const items: PaletteItem[] = blocks.map((b, i) => ({
        id: `block-${i}`,
        label: blocks.length === 1 ? workoutName : `Block ${i + 1}: ${b.preview}`,
        sublabel: b.preview !== `Block ${i + 1}: ${b.preview}` ? b.preview : undefined,
        category: workoutName,
        type: 'action' as const,
        payload: b,
      }));
      if (!low) return items;
      return items.filter(it =>
        it.label.toLowerCase().includes(low) ||
        (it.sublabel ?? '').toLowerCase().includes(low)
      );
    },
  };
}

// ── Feed drill-down (recent journal entries as a source pool) ─────────────

/**
 * Lists recent journal entries as workout sources for the Feed path.
 * Payload: PlaygroundPage (with .content)
 */
export function feedSource(excludeDateKey?: string): PaletteDataSource {
  return {
    id: 'feed-source',
    label: 'Recent Feed',
    search: async (query) => {
      const [lower, upper] = await Promise.all([
        playgroundContent.getPagesByCategory('journal'),
        playgroundContent.getPagesByCategory('Journal'),
      ]);
      const q = query.toLowerCase();
      return [...lower, ...upper]
        .filter(p => {
          const key = p.id.replace(/^journal\//, '');
          return (
            /^\d{4}-\d{2}-\d{2}$/.test(key) &&
            p.id !== `journal/${excludeDateKey}` &&
            (!q || p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)
        .map(p => ({
          id: p.id,
          label: p.name,
          sublabel: formatDateShort(new Date(p.updatedAt)),
          category: 'Recent',
          type: 'journal-entry' as const,
          payload: p,
        }));
    },
  };
}

// ── Journal "create from" sources ─────────────────────────────────────────

export const CREATE_FROM_SOURCE: PaletteDataSource = {
  id: 'create-from',
  label: 'Create from',
  search: async (query) => {
    const options: PaletteItem[] = [
      { id: 'blank',      label: 'Blank',      sublabel: 'Empty entry with a workout block ready to fill in',       category: 'Create from', type: 'action', payload: 'blank' },
      { id: 'collection', label: 'Collection', sublabel: 'Drill into a collection → pick a workout → clone a WOD block', category: 'Create from', type: 'action', payload: 'collection' },
      { id: 'feed',       label: 'Feed',       sublabel: 'Pick a recent entry from your feed and clone a WOD block',  category: 'Create from', type: 'action', payload: 'feed' },
      { id: 'history',    label: 'History',    sublabel: 'Copy the full content of a past journal entry',             category: 'Create from', type: 'action', payload: 'history' },
    ];
    if (!query) return options;
    const low = query.toLowerCase();
    return options.filter(
      o => o.label.toLowerCase().includes(low) || (o.sublabel ?? '').toLowerCase().includes(low)
    );
  },
};

export function journalHistorySource(excludeDateKey?: string): PaletteDataSource {
  return {
    id: 'journal-history',
    label: 'Past Entries',
    search: async (query) => {
      const [lower, upper] = await Promise.all([
        playgroundContent.getPagesByCategory('journal'),
        playgroundContent.getPagesByCategory('Journal'),
      ]);
      const q = query.toLowerCase();
      return [...lower, ...upper]
        .filter(p => {
          const key = p.id.replace(/^journal\//, '');
          return (
            /^\d{4}-\d{2}-\d{2}$/.test(key) &&
            p.id !== `journal/${excludeDateKey}` &&
            (!q || p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)
        .map(p => ({
          id: p.id,
          label: p.name,
          sublabel: formatDateShort(new Date(p.updatedAt)),
          category: 'Journal',
          type: 'journal-entry' as const,
          payload: p,
        }));
    },
  };
}

// ── Tags source ───────────────────────────────────────────────────────────

export function tagsPaletteSource(existingTags: string[] = []): PaletteDataSource {
  return {
    id: 'tags',
    label: 'Tags',
    search: async (query: string) => {
      let allTags: string[] = [];
      try {
        const storedTags = await storageService.getAllTags();
        allTags = storedTags.map((t) => t.label);
      } catch {
        // storage unavailable
      }
      const existingSet = new Set(existingTags);
      const q = query.trim().toLowerCase();
      const results: PaletteItem[] = [];

      // If user typed a query that is not already an exact tag, offer to create it
      if (q && !allTags.some((t) => t.toLowerCase() === q) && !existingSet.has(query.trim())) {
        results.push({
          id: `tag:new:${query.trim()}`,
          label: `Add tag "${query.trim()}"`,
          sublabel: 'Create new tag',
          category: 'New Tag',
          type: 'action',
          payload: { tag: query.trim() },
        });
      }

      // Matching existing tags not yet on this note
      const matched = allTags
        .filter((t) => !existingSet.has(t) && (!q || t.toLowerCase().includes(q)))
        .sort((a, b) => a.localeCompare(b));

      for (const tag of matched) {
        results.push({
          id: `tag:${tag}`,
          label: tag,
          category: 'Existing Tags',
          type: 'action',
          payload: { tag },
        });
      }

      return results;
    },
  };
}
