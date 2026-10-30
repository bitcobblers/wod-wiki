/**
 * DashboardViewPage — renders a dashboard at /dashboard/:slug.
 *
 * The slug resolves to one of two sources (useDashboardSource):
 *  - vault: an editable note — View/Edit mode toggle; edit mode exposes
 *    arrangement (add/edit/duplicate/remove/reorder/size) — every write goes
 *    through journalNotes after a FRESH read, identity-guarded by the
 *    widget's key + body so a stale parse can never retarget another widget.
 *  - prebuilt: a read-only seed (markdown/dashboards/) — widgets carry an
 *    always-visible inspect affordance (query + live preview in the shared
 *    composer, read-only) plus a "Clone to vault" action that stamps the
 *    slug and turns it editable.
 *
 * Authoring (add/edit/inspect) runs in the shared WidgetComposerDialog on
 * the EditorDialog shell; header actions (range, units, mode) ride the
 * ResponsiveActions module so they survive the mobile-hidden page header.
 *
 * The bare /dashboard route (no slug) is the WQL explorer — a separate page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { queryService } from '@/services/queryService';
import {
  RangeSelector,
  AnalyticsUnitPreference,
  useAnalyticsUnitPreference,
  DashboardView,
  type DashboardHeadingAnchor,
} from '@bitcobblers/wod-wiki-ui';
import { useAnalyticsRange } from '../../hooks/useAnalyticsRange';
import { journalNotes } from '../../services/journalNotes';
import { dashboardNotes } from '../../services/dashboardNotes';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/frontmatter';
import { storageService } from '@/services/storage';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';
import { StickyPageHeader } from '@/panels/page-shells';
import {
  parseDashboardNote,
  type WidgetOpResult,
  buildDashboardDocument,
  defaultTokenValues,
  setDashboardTokenValue,
  type DashboardWidget as ModelWidget,
} from '@bitcobblers/wod-wiki-wql';
import {
  appendWidget,
  duplicateWidget,
  moveWidget,
  removeWidget,
  resizeWidget,
  updateWidget,
} from '@bitcobblers/wod-wiki-wql';
import { useDashboardSource } from '../../hooks/useDashboards';
import { analyticsExplorerPath, dashboardsPath, dashboardViewPath } from '../../lib/routes';
import { useNav } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';
import { ResponsiveActions } from '../../nav/ResponsiveActions';
import type { MenuSpec } from '../../nav/menuModel';
import type { Entry } from '../../lib/entryMapper';
import { NoteContextNav, EMPTY_NOTE_CONTEXT } from '../../pages/shared/noteContextLinks';
import { SampleDataPrompt } from '../analytics/SampleDataPrompt';
import { WidgetComposerDialog, type WidgetComposerApply } from './WidgetComposerDialog';

/** Sticky-page-title anchor — the surface for the note's `#` h1 / doc.title L3 entry. */
const TITLE_ANCHOR = 'dashboard-title';

type ComposerState =
  | { mode: 'add'; expectedRaw: string }
  | { mode: 'edit' | 'inspect'; widget: ModelWidget; expectedRaw: string };

export function DashboardViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [weeks] = useAnalyticsRange();
  const { unit: preferredUnit } = useAnalyticsUnitPreference();
  const rangeStart = Date.now() - weeks * 7 * 86400000;
  const rangeEnd = Date.now();

  // refreshKey forces re-resolution after a clone or an edit write-back.
  const [refreshKey, setRefreshKey] = useState(0);
  // Board-emptiness probe: an O(1) event count gates the fresh-profile CTA
  // card — widgets render their own empty states once facts exist.
  const [hasFacts, setHasFacts] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void storageService.countEvents().then((n) => {
      if (!cancelled) setHasFacts(n > 0);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);
  const { source, loading } = useDashboardSource(slug, refreshKey);

  const parsed = useMemo(() => {
    if (!source?.rawContent) return null;
    const { meta, sections } = parseDashboardNote(source.rawContent);
    return { doc: buildDashboardDocument(sections, meta), sections };
  }, [source]);
  const document = parsed?.doc ?? null;

  // L3 outline: every entry targets a real surface — doc.title the sticky
  // page header, standalone note headings their own grid heading row, and
  // each query block its widget card. Titled headings (buildDashboardDocument
  // adjacency) surface as their widget entry's label.
  const { setL3Items, registerScrollFn } = useNav();
  const outline = useMemo(() => {
    if (!parsed) return { headings: [], items: [] as NavItemL3[] };
    const { doc, sections } = parsed;
    const titled = new Set<number>();
    sections.forEach((s, i) => {
      if (s.type !== 'query') return;
      const above = sections[i - 1];
      if (above?.type === 'markdown' && above.subtype === 'paragraph') {
        const h = sections[i - 2];
        if (h?.type === 'markdown' && h.subtype === 'heading') titled.add(i - 2);
      } else if (above?.type === 'markdown' && above.subtype === 'heading') {
        titled.add(i - 1);
      }
    });
    const headings: DashboardHeadingAnchor[] = [];
    const items: NavItemL3[] = [];
    if (doc.title) {
      items.push({ id: TITLE_ANCHOR, label: doc.title, level: 3, action: { type: 'scroll', sectionId: TITLE_ANCHOR } });
    }
    let widgetIdx = 0;
    sections.forEach((s, i) => {
      if (s.type === 'markdown' && s.subtype === 'heading') {
        if (titled.has(i) || /^#\s/.test(s.content)) return; // level 1 = the page title surface above
        const id = `note-h${i}`;
        const text = s.content.replace(/^#+\s*/, '');
        headings.push({ id, level: /^#+/.exec(s.content)?.[0].length ?? 2, text, beforeWidget: widgetIdx });
        items.push({ id, label: text, level: 3, action: { type: 'scroll', sectionId: id } });
        return;
      }
      if (s.type !== 'query') return;
      const w = doc.widgets[widgetIdx];
      if (!w) return;
      widgetIdx++;
      const sectionId = `widget-${w.key}`;
      items.push({ id: sectionId, label: w.title || w.body, level: 3, action: { type: 'scroll', sectionId } });
    });
    return { headings, items };
  }, [parsed]);
  // Declared early so the L3 helpful actions below can close over them.
  const [editMode, setEditMode] = useState(false);
  const handleClone = useCallback(async () => {
    if (!source || source.editable) return;
    await dashboardNotes.cloneDashboard(source.slug, source.rawContent, source.title);
    setRefreshKey((k) => k + 1); // re-resolve → vault clone shadows the seed
  }, [source]);
  // Whiteboard dashboard L3: on-this-page/widget links first, then Edit/Done,
  // Clone to vault, Copy link, and the range/units view controls as live L3
  // widgets (rendered by the rail + mobile right drawer via NavItem.panel).
  const RangeWidget = useCallback(() => <RangeSelector />, [])
  const UnitsWidget = useCallback(() => <AnalyticsUnitPreference />, [])
  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href)
  }, [])
  const l3Items = useMemo(() => [
    ...outline.items,
    { id: 'dashboard-range', label: 'Date range', level: 3 as const, action: { type: 'none' as const }, panel: RangeWidget },
    { id: 'dashboard-units', label: 'Units', level: 3 as const, action: { type: 'none' as const }, panel: UnitsWidget },
    { id: 'helpful-edit', label: editMode ? 'Done' : 'Edit', level: 3 as const, action: { type: 'call' as const, handler: () => setEditMode(v => !v) } },
    ...(!source?.editable && source ? [{ id: 'helpful-clone', label: 'Clone to vault', level: 3 as const, action: { type: 'call' as const, handler: () => void handleClone() }, key: source.slug }] : []),
    { id: 'helpful-copy-link', label: 'Copy link', level: 3 as const, action: { type: 'call' as const, handler: handleCopyLink } },
  ], [outline.items, editMode, source, RangeWidget, UnitsWidget, handleClone, handleCopyLink]);
  useEffect(() => {
    setL3Items(l3Items);
    return () => setL3Items([]);
  }, [l3Items, setL3Items]);

  // Whiteboard dashboard L2: Up to Dashboards; recent dashboards (this one
  // filtered out).
  const dashboardL2 = useMemo(() => ({
    up: { id: 'dashboards', title: 'Dashboards', to: dashboardsPath() },
    trailingSections: [
      {
        kind: 'wql' as const,
        id: 'recent-dashboards',
        label: 'Recent dashboards',
        query: ':note{type:dashboard}',
        limit: 5,
        toEntry: (e: Entry) => dashboardViewPath(e.id),
        filterEntry: (e: Entry) => e.id !== source?.noteId,
      },
    ] as MenuSpec,
  }), [source]);

  // Outline clicks scroll and flash. The component `document` (parsed
  // DashboardDocument) shadows the DOM global here — hence globalThis.
  // The context scroll slot is a single ref: restore plain scroll on unmount.
  useEffect(() => {
    registerScrollFn((id) => {
      const el = globalThis.document.getElementById(id);
      if (!el) return;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
      if (typeof el.animate === 'function') {
        el.animate(
          [{ boxShadow: '0 0 0 3px hsl(var(--primary))' }, { boxShadow: '0 0 0 3px transparent' }],
          { duration: 1500, easing: 'ease-out' },
        );
      }
    });
    return () =>
      registerScrollFn((id) => {
        const el = globalThis.document.getElementById(id);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
      });
  }, [registerScrollFn]);

  // editMode is declared early (the L3 helpful actions close over it).
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // Visible refusal surface for toolbar widget ops that lost the revision
  // race (a concurrent edit landed between render and write).
  const [actionError, setActionError] = useState<string | null>(null);

  // Every widget mutation: fresh read → revision check → guarded op →
  // single write. `expectedRaw` is the note revision captured when the
  // action started (editor open / toolbar click). The key+body guard alone
  // cannot tell apart two identical-query widgets swapped by a reorder —
  // the raw revision can. A mismatch THROWS: the caller surfaces the refusal
  // and keeps the draft; the board refreshes to the latest content.
  const mutateNote = useCallback(
    async (expectedRaw: string, mutate: (raw: string) => string | Extract<WidgetOpResult, { ok: true }> | null) => {
      if (!source?.editable || !source.noteId) return;
      const note = await journalNotes.getById(source.noteId);
      if (note.rawContent !== expectedRaw) {
        setRefreshKey((k) => k + 1);
        throw new Error('The dashboard changed elsewhere — this edit was not saved.');
      }
      const next = mutate(note.rawContent);
      if (next == null) {
        setRefreshKey((k) => k + 1);
        throw new Error('The widget changed on disk — this edit was not saved.');
      }
      await journalNotes.update(note, typeof next === 'string' ? next : next.note, typeof next === 'string' ? undefined : next);
      setRefreshKey((k) => k + 1);
    },
    [source],
  );

  const handleTokenChange = useCallback(
    async (name: string, value: string) => {
      if (!source?.editable || !source.noteId) return;
      // Fresh read — never patch frontmatter onto a stale rawContent closure.
      const note = await journalNotes.getById(source.noteId);
      const { meta, body } = parseFrontmatter(note.rawContent);
      const newMeta = setDashboardTokenValue(meta, name, value);
      const raw = `---\n${serializeFrontmatter(newMeta)}\n---\n${body}`;
      await journalNotes.update(note, raw);
      setRefreshKey((k) => k + 1);
    },
    [source],
  );

  // Toolbar actions (duplicate/remove/reorder/size) start from the revision
  // on screen; a refusal lands in the visible action-error banner.
  const runWidgetOp = useCallback(
    (expectedRaw: string, mutate: (raw: string) => WidgetOpResult) => {
      setActionError(null);
      void mutateNote(expectedRaw, (raw) => {
        const result = mutate(raw);
        if (!result.ok) {
          // Structured refusals (decision 22): not-found vs stale-body are
          // distinct failures — both refuse the write. (Discriminant access
          // is explicit: the app compiles without strictNullChecks, so union
          // narrowing by `ok` is unavailable.)
          const reason = (result as { reason?: 'not-found' | 'stale-body' }).reason;
          throw new Error(
            reason === 'stale-body'
              ? 'Widget changed since you opened this page — reload and retry.'
              : 'Widget no longer exists — reload the dashboard.',
          );
        }
        return result;
      }).catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : String(err));
      });
    },
    [mutateNote],
  );

  const handleComposerApply = useCallback(
    async (spec: WidgetComposerApply) => {
      if (!composer || composer.mode === 'inspect') return;
      // Throws on a stale revision — the composer catches, shows the refusal,
      // and keeps the draft open.
      if (composer.mode === 'add') {
        await mutateNote(composer.expectedRaw, (raw) => appendWidget(raw, spec));
      } else {
        const widget = composer.widget;
        await mutateNote(composer.expectedRaw, (raw) => {
          const result = updateWidget(raw, widget.key, widget.body, spec);
          if (!result.ok) {
            const reason = (result as { reason?: 'not-found' | 'stale-body' }).reason;
            throw new Error(
              reason === 'stale-body'
                ? 'Widget changed since you opened this page — reload and retry.'
                : 'Widget no longer exists — reload the dashboard.',
            );
          }
          return result;
        });
      }
    },
    [composer, mutateNote],
  );

  // handleClone is declared early (the L3 helpful actions close over it).

  // A refresh (new refreshKey) flips the hook to loading=true but KEEPS the
  // previously resolved source — gate the early returns on source-readiness,
  // not on loading alone, or the whole page (composer draft included)
  // unmounts mid-refresh. A source from a different slug is never shown.
  const sourceReady = source != null && source.slug === slug;

  if (loading && !sourceReady) {
    return <div className="p-8 text-sm text-muted-foreground">Loading dashboard…</div>;
  }
  if (!sourceReady || !source) {
    return (
      <div className="p-8" data-testid="dashboard-not-found">
        <h1 className="text-lg font-bold text-foreground mb-2">Dashboard not found</h1>
        <p className="text-sm text-muted-foreground mb-4">
          No dashboard named <code>{slug}</code>. It may have been removed.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          Back to explorer
        </button>
      </div>
    );
  }

  const editable = source.editable;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NoteContextNav data={EMPTY_NOTE_CONTEXT} up={dashboardL2.up} trailingSections={dashboardL2.trailingSections} />
      <StickyPageHeader
        id={TITLE_ANCHOR}
        title={document?.title || source.title}
        subtitle={editable ? 'Editable dashboard note.' : 'Prebuilt — read-only until cloned to your vault.'}
        actions={
          // Whiteboard dashboard sticky: Edit/Done + Cast. Range and units
          // moved to L3 view controls (dashboard-range / dashboard-units
          // widgets); the helpful actions mirror them in the ⋯ surfaces.
          <div className="flex items-center gap-2">
            <ResponsiveActions
              label="Dashboard actions"
              primary={
                editable ? (
                  <button
                    type="button"
                    data-testid="dashboard-edit-toggle"
                    aria-pressed={editMode}
                    onClick={() => setEditMode((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      editMode
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Pencil size={12} /> {editMode ? 'Done' : 'Edit'}
                  </button>
                ) : undefined
              }
            />
            <CastButtonRpc />
          </div>
        }
      />
      <div className="max-w-[1500px] w-full mx-auto p-4 md:p-6 lg:p-8 flex-1">

        {actionError && (
          <div
            role="alert"
            data-testid="dashboard-action-error"
            className="mb-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          >
            <span>{actionError}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setActionError(null)}
              className="font-medium hover:opacity-70 transition-opacity"
            >
              ×
            </button>
          </div>
        )}

        {!editable && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-xs">
            <span className="text-foreground">
              This is a read-only prebuilt. Clone it to edit widgets and tokens.
            </span>
            <button
              type="button"
              data-testid="clone-dashboard"
              onClick={handleClone}
              className="font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Clone to vault
            </button>
          </div>
        )}

        {editable && editMode && (
          <button
            type="button"
            data-testid="add-widget"
            onClick={() => setComposer({ mode: 'add', expectedRaw: source.rawContent })}
            className="mb-4 flex items-center gap-1.5 rounded-lg border border-dashed border-primary/50 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus size={13} /> Add widget
          </button>
        )}

        {hasFacts === false ? (
          <SampleDataPrompt
            layout="card"
            refreshKey={refreshKey}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <div className="mb-4">
            <SampleDataPrompt
              layout="banner"
              refreshKey={refreshKey}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </div>
        )}

        {document && (
          <DashboardView
            document={document}
            headings={outline.headings}
            executor={queryService}
            onTokenChange={editable ? handleTokenChange : undefined}
            editMode={editable && editMode}
            onEditWidget={editable ? (w) => setComposer({ mode: 'edit', widget: w, expectedRaw: source.rawContent }) : undefined}
            onDuplicateWidget={editable ? (w) => runWidgetOp(source.rawContent, (raw) => duplicateWidget(raw, w.key, w.body)) : undefined}
            onRemoveWidget={editable ? (w) => runWidgetOp(source.rawContent, (raw) => removeWidget(raw, w.key, w.body)) : undefined}
            onMoveWidget={editable ? (w, delta) => runWidgetOp(source.rawContent, (raw) => moveWidget(raw, w.key, w.body, delta)) : undefined}
            onResizeWidget={editable ? (w, span) => runWidgetOp(source.rawContent, (raw) => resizeWidget(raw, w.key, w.body, span)) : undefined}
            onInspectWidget={!editable ? (w) => setComposer({ mode: 'inspect', widget: w, expectedRaw: source.rawContent }) : undefined}
            onOpenInExplorer={(w, q) => navigate(analyticsExplorerPath({ q }))}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            preferredUnit={preferredUnit}
          />
        )}

      </div>

      <WidgetComposerDialog
        open={composer !== null}
        onClose={() => setComposer(null)}
        mode={composer?.mode ?? 'add'}
        initialWql={
          composer && composer.mode !== 'add'
            ? composer.widget.body
            : 'sum:totalVolume{}'
        }
        initial={
          composer && composer.mode !== 'add'
            ? {
                title: composer.widget.title,
                question: composer.widget.question,
                type: composer.widget.type,
                spanCols: composer.widget.spanCols,
                spanFull: composer.widget.spanFull,
                attributes: composer.widget.attributes,
              }
            : undefined
        }
        executor={queryService}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        preferredUnit={preferredUnit}
        tokenValues={document ? defaultTokenValues(document.tokens) : undefined}
        onApply={composer?.mode === 'inspect' ? undefined : handleComposerApply}
        footerExtra={
          composer?.mode === 'inspect' ? (
            <button
              type="button"
              data-testid="inspect-clone"
              onClick={() => {
                void handleClone().then(() => {
                  setComposer(null);
                  setEditMode(true);
                });
              }}
              className="px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 rounded-lg border border-primary/40 hover:bg-primary/10 transition-colors"
            >
              Clone to vault to edit
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
