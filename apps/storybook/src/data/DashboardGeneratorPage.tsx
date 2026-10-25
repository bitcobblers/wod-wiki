/**
 * Dashboard Generator — writes a NEW dashboard note into the ACTIVE database
 * through the app's notePersistence, using the canonical wql scaffold/widget
 * format so a generated board is byte-compatible with the playground app.
 *
 * The page lists every dashboard note in the active database and renders the
 * selected one through the shared DashboardView (widgets execute live via
 * the app's queryService).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  appendWidget,
  buildDashboardDocument,
  buildDashboardScaffold,
  dashboardSlug,
  parseDashboardNote,
  DEFAULT_DASHBOARD_TITLE,
  type DashboardSectionInput,
} from '@bitcobblers/wod-wiki-wql';
import { DashboardView, type DashboardHeadingAnchor } from '@bitcobblers/wod-wiki-ui';
import type { HistoryEntry } from '@/types/history';
import { notePersistence } from '@/services/persistence';
import { queryService } from '@/services/queryService';
import { useDatabase } from '../database/DatabaseContext';

const SEED_QUERY = 'sum:totalVolume{} by {week}';

/** Standalone note headings between widgets — a heading adjacent to a widget
 *  (directly, or across its question paragraph) belongs to that widget's
 *  card; level 1 is the page title surface. */
function buildHeadings(sections: readonly DashboardSectionInput[]): DashboardHeadingAnchor[] {
  const headings: DashboardHeadingAnchor[] = [];
  let widgetIdx = 0;
  sections.forEach((section, i) => {
    if (section.type !== 'markdown' || section.subtype !== 'heading') {
      if (section.type === 'query') widgetIdx++;
      return;
    }
    const next = sections[i + 1];
    const next2 = sections[i + 2];
    const titled =
      next?.type === 'query' ||
      (next?.type === 'markdown' && next.subtype === 'paragraph' && next2?.type === 'query');
    if (titled || /^#\s/.test(section.content)) return;
    headings.push({
      id: `note-h${i}`,
      level: /^#+/.exec(section.content)?.[0].length ?? 2,
      text: section.content.replace(/^#+\s*/, ''),
      beforeWidget: widgetIdx,
    });
  });
  return headings;
}

export function DashboardGeneratorPage() {
  const { dataVersion } = useDatabase();
  const [title, setTitle] = useState(DEFAULT_DASHBOARD_TITLE);
  const [question, setQuestion] = useState('How has volume trended over time?');
  const [wql, setWql] = useState(SEED_QUERY);
  const [dashboards, setDashboards] = useState<HistoryEntry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (): Promise<HistoryEntry[]> => {
    const entries = await notePersistence.listNotes({ kind: 'dashboard' });
    setDashboards(entries);
    return entries;
  }, []);

  // Re-read when the active database's content changes (the feed import
  // landed, or the user switched databases).
  useEffect(() => { void refresh(); }, [refresh, dataVersion]);

  const create = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedQuery = wql.trim();
    if (!trimmedTitle || !trimmedQuery) {
      setError('A title and a WQL query are required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const scaffold = buildDashboardScaffold(trimmedTitle);
      const rawContent = appendWidget(scaffold, {
        question: question.trim() || undefined,
        type: '',
        wql: trimmedQuery,
      });
      const created = await notePersistence.createNote({
        id: crypto.randomUUID(),
        title: trimmedTitle,
        rawContent,
        targetDate: Date.now(),
        type: 'dashboard',
        slug: dashboardSlug(trimmedTitle),
        sourceId: 'dashboards',
      });
      await refresh();
      setOpenId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [title, question, wql, refresh]);

  const opened = dashboards.find((d) => d.id === openId) ?? null;
  const openedDoc = useMemo(() => {
    if (!opened) return null;
    const { meta, sections } = parseDashboardNote(opened.rawContent);
    return { doc: buildDashboardDocument(sections, meta), sections };
  }, [opened]);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Dashboard Generator</h2>
        <p className="text-xs text-muted-foreground">
          Creates a dashboard note in the active database — scaffold plus one widget, in the
          canonical format. Read back below.
        </p>
      </div>

      <form
        className="grid gap-2 rounded border border-border bg-card p-3"
        data-testid="dashboard-generator-form"
        onSubmit={(e) => { e.preventDefault(); void create(); }}
      >
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Title</span>
          <input
            data-testid="dashboard-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Question</span>
          <input
            data-testid="dashboard-question-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What does this widget answer?"
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Widget WQL</span>
          <input
            data-testid="dashboard-query-input"
            value={wql}
            onChange={(e) => setWql(e.target.value)}
            spellCheck={false}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
          />
        </label>
        {error && (
          <p className="text-xs text-destructive" data-testid="dashboard-generator-error" role="alert">{error}</p>
        )}
        <button
          type="submit"
          disabled={creating}
          data-testid="dashboard-create"
          className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={12} /> Create dashboard
        </button>
      </form>

      <div className="rounded border border-border bg-card" data-testid="dashboard-list">
        <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {dashboards.length} dashboard{dashboards.length === 1 ? '' : 's'} in the active database
        </div>
        {dashboards.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground" data-testid="dashboard-list-empty">
            No dashboard notes yet — create one above.
          </p>
        )}
        <ul>
          {dashboards.map((d) => (
            <li key={d.id} className="border-b border-border/50 px-3 py-2 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(d.id)}
                data-testid="dashboard-row"
                className={`w-full text-left ${d.id === openId ? 'text-primary' : 'text-foreground'} hover:text-primary`}
              >
                <span className="text-sm font-medium">{d.title}</span>{' '}
                <span className="font-mono text-[10px] text-muted-foreground">{d.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {opened && openedDoc && (
        <div className="rounded border border-border bg-card p-3" data-testid="dashboard-view">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">{openedDoc.doc.title ?? opened.title}</h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {openedDoc.doc.widgets.length} widget{openedDoc.doc.widgets.length === 1 ? '' : 's'}
            </span>
          </div>
          <DashboardView
            document={openedDoc.doc}
            headings={buildHeadings(openedDoc.sections)}
            executor={queryService}
            rangeStart={Date.now() - 12 * 7 * 86400000}
            rangeEnd={Date.now()}
          />
        </div>
      )}
    </div>
  );
}
