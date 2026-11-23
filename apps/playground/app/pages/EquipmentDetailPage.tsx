/**
 * EquipmentDetailPage — /equipment/:slug
 *
 * Equipment as a first-class note page, mirroring EffortDetailPage:
 *   - JournalPageShell with NoteEditor (same document/undo path for create
 *     and edit — no detached form, no textarea-only page)
 *   - YAML frontmatter edited inline by the editor's property widget
 *   - Bundled equipment is read-only until first edit, which auto-clones
 *   - Create ("/equipment/<slug>?mode=create", or slug "new") uses the same
 *     editor layout; save commits note + projection through the shared
 *     commitReferenceNote seam.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { notebookSlugFromId, toNotebookId } from '@bitcobblers/wod-wiki-engine';
import { DocumentDuplicateIcon } from '@heroicons/react/20/solid';
import { Button, Badge } from "@bitcobblers/wod-wiki-ui/primitives";
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { useTheme } from '@/contexts/ThemeProvider';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import { useColdRouteResolution } from '../hooks/useColdRouteResolution';
import { useEquipmentContent, useEquipmentLinks, blankEquipmentDocument } from '../hooks/useEquipmentContent';
import { useNotePageNav } from './shared/useNotePageNav';
import {
  NoteContextNav,
  noteOwnership,
  notesFacetFilterPath,
  useNoteContextLinks,
  noteLinkPath,
  type ContextNoteLink,
} from './shared/noteContextLinks';
import { PageActions } from './shared/PageActions';
import { useEquipmentRegistry } from '../contexts/EquipmentRegistryContext';
import { equipmentPath, effortPath, ROUTE_PATTERNS } from '../lib/routes';
import type { MenuSpec } from '../nav/menuModel';
import { toast } from '@/hooks/use-toast';
import { TEST_IDS } from '@/lib/testIds';
import { documentToEquipment } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { fileToDisplayName } from '@/repositories/groupings';
import { appendWidget, resolveEntityScope } from '@bitcobblers/wod-wiki-wql';
import { queryService } from '@/services/queryService';
import { WidgetComposerDialog } from '../views/dashboards/WidgetComposerDialog';
import { storageService } from '@/services/storage';
import { PropertyOverrideSheet } from '@/components/organisms/notebook/PropertyOverrideSheet';
export function EquipmentDetailPage() {
  const { slug: slugParam, tag: tagParam } = useParams<{ slug?: string; tag?: string }>();
  const slug = slugParam ?? tagParam;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawNotebookParam = searchParams.get('notebook')?.trim() ?? '';
  const scopedNotebookId = useMemo(() => {
    if (!rawNotebookParam) return null;
    const normalized = toNotebookId(rawNotebookParam);
    return normalized === 'notebook/custom' ? null : normalized;
  }, [rawNotebookParam]);
  const { theme } = useTheme();
  const actualTheme = theme === 'dark' ? 'dark' : 'vs';
  const { isReady, refresh } = useEquipmentRegistry();

  const isCreateMode = searchParams.get('mode') === 'create' || slug === 'new';
  const {
    document,
    setDocument,
    isLoading,
    equipment,
    isEditable,
    notFound,
    cloneForEdit,
    error,
    onLineChange,
    onBlur,
    flush,
  } = useEquipmentContent(slug);
  const { isSettling } = useColdRouteResolution({
    loading: !isReady || isLoading,
    missing: !isCreateMode && !equipment && !error && notFound,
  });

  const previousSlugRef = useRef(equipment?.slug);
  useEffect(() => {
    const previous = previousSlugRef.current;
    if (equipment && previous && equipment.slug !== previous && equipment.registrySource === 'user') {
      void navigate(equipmentPath(equipment.slug));
    }
    previousSlugRef.current = equipment?.slug;
  }, [equipment, navigate]);

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);
  const [widgetComposerOpen, setWidgetComposerOpen] = useState(false);
  const [overrideSheetOpen, setOverrideSheetOpen] = useState(false);
  const equipmentScope = useMemo(
    () => (slug ? resolveEntityScope({ kind: 'equipment', slug, label: equipment?.label ?? slug }) : null),
    [slug, equipment?.label],
  );
  // ── Create mode ("/equipment/new?mode=create" or "?mode=create" on any slug) ──
  const [createDocument, setCreateDocument] = useState(() => {
    const doc = blankEquipmentDocument(
      slug && slug !== 'new' ? slug.trim().toLowerCase().replace(/\s+/g, '-') : '',
    );
    return doc.endsWith('\n\n') ? doc : `${doc}\n\n`;
  });
  const createDocumentRef = useRef(createDocument);
  const handleCreateDocumentChange = useCallback((next: string) => {
    createDocumentRef.current = next;
    setCreateDocument(next);
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const activeCreateDoc = createDocumentRef.current;
    const { equipment: parsed, errors } = documentToEquipment(activeCreateDoc);
    if (errors.length > 0) {
      toast({ title: 'Invalid YAML', description: errors.join('\n'), variant: 'destructive' });
      return;
    }
    // The slug in the document IS the projection identity — validate it, never
    // silently commit a normalized rewrite that diverges from the source.
    const slugValue = parsed.slug.trim();
    if (!slugValue) {
      toast({ title: 'Missing slug', description: 'A unique slug is required.', variant: 'destructive' });
      return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugValue)) {
      toast({
        title: 'Invalid slug',
        description: `Slug must be lowercase and hyphenated — fix "slug: ${slugValue}" in the document.`,
        variant: 'destructive',
      });
      return;
    }
    try {
      await commitReferenceNote({
        kind: 'equipment',
        slug: slugValue,
        rawContent: activeCreateDoc,
        title: parsed.label.trim() || fileToDisplayName(slugValue),
        expectedSourceRevision: 0,
      });
      await refresh();
      void navigate(equipmentPath(slugValue), { replace: true });
    } catch (err) {
      // Draft state is untouched — the document stays editable in the editor.
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save equipment.',
        variant: 'destructive',
      });
    }
  }, [refresh, navigate]);

  // ── L3 nav from document content (display-only links — equipment bodies
  // are reference material, not runnable workouts) ──────────────────────────
  // Whiteboard equipment L3: Clone (read-only) and Copy link after the
  // outline. `key` republishes when the equipment loads so Clone's closure
  // never stays null.
  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href)
  }, [])
  useNotePageNav({
    content: isCreateMode ? createDocument : document,
    scriptBlocks,
    enableUnrecognizedActions: false,
    helpfulActions: [
      ...(equipment
        ? [
            {
              id: 'override',
              label: !isEditable ? 'Override Equipment' : 'Override Scope',
              testId: TEST_IDS.L3_EQUIPMENT_OVERRIDE,
              group: 'primary' as const,
              onRun: () => setOverrideSheetOpen(true),
              key: `ov-${equipment.slug}`,
            },
          ]
        : []),
      ...(equipment
        ? [
            {
              id: 'add-widget',
              label: 'Add widget',
              group: 'author' as const,
              onRun: () => setWidgetComposerOpen(true),
            },
          ]
        : []),
      ...(equipment && !isEditable
        ? [
            {
              id: 'clone',
              label: 'Clone to my catalog',
              icon: DocumentDuplicateIcon,
              testId: TEST_IDS.EQUIPMENT_DETAIL_CLONE_BTN,
              group: 'organize' as const,
              onRun: () => void handleClone(),
              key: equipment.slug,
            },
          ]
        : []),
      { id: 'copy-link', label: 'Copy link', group: 'share' as const, onRun: handleCopyLink },
    ],
  });

  // ── Contextual links + guaranteed `< Equipment` parent fallback even for
  // UUID-backed seed records.
  const ownerNoteId = equipment?.ownerNoteId ?? (slug ? `equipment/${slug}` : '');
  const ownership = useMemo(
    () => (ownerNoteId ? noteOwnership({ id: ownerNoteId, type: 'collection' }) : null),
    [ownerNoteId],
  );
  const parentLink: ContextNoteLink = useMemo(
    () => ownership?.up ?? { id: 'equipment', title: 'Equipment', to: ROUTE_PATTERNS.equipment },
    [ownership?.up],
  );
  const stamps = useMemo(
    () => (ownership?.stamps.length ? ownership.stamps : slug ? [equipmentPath(slug)] : []),
    [ownership?.stamps, slug],
  );
  const baseContext = useNoteContextLinks({
    noteId: ownerNoteId,
    stamps,
  });
  const links = useEquipmentLinks(equipment?.slug);
  const contextData = useMemo(() => ({
    efforts: links.efforts.map(e => ({ id: e.slug, title: e.label, to: effortPath(e.slug) })),
    related: links.usedBy.map(u => ({ id: u.noteId, title: u.title, to: noteLinkPath(u.noteId) })),
    relatedTotal: links.usedBy.length,
    relatedViewAllTo: equipment?.slug ? notesFacetFilterPath('equipment', equipment.slug) : undefined,
    backlinks: baseContext.backlinks,
  }), [links, equipment?.slug, baseContext.backlinks]);
  // Whiteboard equipment L2: related efforts (section above), recent
  // equipment last.
  const trailingSections = useMemo<MenuSpec>(() => [
    {
      kind: 'wql',
      id: 'recent-equipment',
      label: 'Recent equipment',
      query: ':equipment{}',
      limit: 5,
      toEntry: (e) => equipmentPath(e.id),
      filterEntry: (e) => e.id !== equipment?.ownerNoteId && e.id !== `equipment/${equipment?.slug ?? ''}`,
    },
  ], [equipment]);

  // ── Page title ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (equipment) {
      window.document.title = `Wod.Wiki - ${equipment.label}`;
    }
  }, [equipment]);

  // ── Handle clone for edit ────────────────────────────────────────────────
  const handleClone = useCallback(async () => {
    if (!equipment) return;
    try {
      // cloneForEdit awaits the persisted copy commit — navigate only after.
      const cloned = await cloneForEdit();
      if (cloned) {
        void navigate(equipmentPath(cloned.slug));
        toast({
          title: 'Cloned',
          description: `Created a custom copy of "${equipment.label}". You can now edit it.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Clone failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [cloneForEdit, equipment, navigate]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (!isReady || isLoading || (!isCreateMode && (notFound || !equipment) && isSettling && !error)) {
    return (
      <div role="status" className="flex items-center justify-center py-20">
        <div className="animate-pulse h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (isCreateMode) {
    const pageActions = (
      <ResponsiveActions
        navbar={
          <Button
            onClick={handleCreateSubmit}
            data-testid={TEST_IDS.EQUIPMENT_CREATE_BTN}
            className="max-lg:min-h-11 max-lg:px-2.5 max-lg:text-xs whitespace-nowrap"
          >
            Create Equipment
          </Button>
        }
      >
        <Button variant="outline" onClick={() => navigate(ROUTE_PATTERNS.equipment)}>
          Cancel
        </Button>
      </ResponsiveActions>
    );
    return (
      <div data-testid={TEST_IDS.EQUIPMENT_DETAIL_ROOT} className="contents">
        <JournalPageShell
          parent={{ label: 'Equipment', to: ROUTE_PATTERNS.equipment }}
          title={slug && slug !== 'new' ? `New equipment: ${slug}` : 'New equipment'}
          actions={pageActions}
          editor={
            <div className="relative" data-testid="equipment-create-editor">
              <NoteEditor
                value={createDocument}
                onChange={handleCreateDocumentChange}
                theme={actualTheme}
                readonly={false}
                showLineNumbers={true}
                enablePreview={true}
                enableLinting={true}
                enableOverlay={true}
                mode="edit"
                onBlocksChange={setScriptBlocks}
              />
            </div>
          }
        />
      </div>
    );
  }

  if (error) {
    // A storage/load failure is actionable on its own — it must not masquerade
    // as "not found" (which offers to create a colliding definition).
    return (
      <div data-testid={TEST_IDS.EQUIPMENT_LOAD_ERROR} className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center max-w-lg mx-auto">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Equipment could not be loaded</h2>
          <p className="text-sm text-destructive">{error}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(ROUTE_PATTERNS.equipment)}>
            Back to Equipment
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !equipment) {
    return (
      <div data-testid={TEST_IDS.EQUIPMENT_NOT_FOUND} className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center max-w-lg mx-auto">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Equipment &ldquo;{slug}&rdquo; not found</h2>
          <p className="text-sm text-muted-foreground">
            No equipment definition exists for this slug yet. You can create a new definition page for it.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={() => navigate(`${equipmentPath(slug ?? 'new')}?mode=create`)}
            data-testid={TEST_IDS.EQUIPMENT_NOT_FOUND_CREATE_BTN}
          >
            Create Equipment Page
          </Button>
          <Button variant="outline" onClick={() => navigate(ROUTE_PATTERNS.equipment)}>
            Back to Equipment
          </Button>
        </div>
      </div>
    );
  }

  // ── Actions bar (rendered by JournalPageShell actions prop) ──────────────
  // Clean detail StickyPageHeader: < Parent + Title + Cast + passive Sync +
  // <2xl L3DrawerTrigger ONLY. Override and Clone live in grouped L3 Actions.
  const pageActions = <PageActions mode="notebook-readonly" index={[]} />;

  const sourceLabel = scopedNotebookId
    ? `Scoped · ${notebookSlugFromId(scopedNotebookId)}`
    : equipment.registrySource === 'bundled'
      ? 'Bundled'
      : 'Custom';

  return (
    <div data-testid={TEST_IDS.EQUIPMENT_DETAIL_ROOT} className="contents">
      <JournalPageShell
        parent={{ label: parentLink.title, to: parentLink.to ?? ROUTE_PATTERNS.equipment }}
        title={equipment.label}
        titleTestId={TEST_IDS.EQUIPMENT_DETAIL_LABEL}
        actions={pageActions}
        editor={
          <div className="relative" data-testid={TEST_IDS.EQUIPMENT_DETAIL_NOTEBOOK_EDITOR}>
            <div className="flex flex-wrap items-center gap-2 px-6 lg:px-10 pt-4">
              <Badge
                data-testid={TEST_IDS.EQUIPMENT_DETAIL_SOURCE}
                variant={equipment.registrySource === 'bundled' && !scopedNotebookId ? 'secondary' : 'default'}
              >
                {sourceLabel}
              </Badge>
            </div>
            <NoteEditor
              noteId={ownerNoteId}
              value={document}
              onChange={setDocument}
              onCursorPositionChange={onLineChange}
              onBlur={onBlur}
              onSaveRequest={flush}
              onCommitChange={flush}
              theme={actualTheme}
              readonly={false}
              showLineNumbers={true}
              enablePreview={true}
              enableLinting={true}
              enableOverlay={true}
              mode="edit"
              onBlocksChange={setScriptBlocks}
            />
            {(contextData.efforts.length > 0 || contextData.related.length > 0 || contextData.backlinks.length > 0) && (
              <section
                aria-label="Backlinks and usage"
                data-testid={TEST_IDS.EQUIPMENT_INLINE_BACKLINKS}
                className="mt-6 border-t border-border pt-4 space-y-3"
              >
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Backlinks &amp; Used in
                </h2>
                {contextData.efforts.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Related efforts</div>
                    <ul className="flex flex-wrap gap-2">
                      {contextData.efforts.map((item) => (
                        <li key={item.id}>
                          <Link
                            to={item.to}
                            className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {contextData.related.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Used in notes</div>
                    <ul className="flex flex-wrap gap-2">
                      {contextData.related.map((item) => (
                        <li key={item.id}>
                          <Link
                            to={item.to}
                            className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {contextData.backlinks.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Backlinks</div>
                    <ul className="flex flex-wrap gap-2">
                      {contextData.backlinks.map((item) => (
                        <li key={item.id}>
                          <Link
                            to={item.to}
                            className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
            <NoteContextNav
              data={contextData}
              up={parentLink}
              relatedLabel="Used in"
              relatedViewAllTo={equipment.slug ? notesFacetFilterPath('equipment', equipment.slug) : undefined}
              currentPath={equipmentPath(equipment.slug)}
              trailingSections={trailingSections}
            />
          </div>
        }
      />
      <WidgetComposerDialog
        open={widgetComposerOpen}
        onClose={() => setWidgetComposerOpen(false)}
        mode="add"
        initialWql={equipmentScope ? `sum:totalVolume{${equipmentScope.scopeFilter}} by {week}` : 'sum:totalVolume{} by {week}'}
        subsetQuery={equipmentScope?.notesWql ?? null}
        executor={queryService}
        tokenValues={equipmentScope?.tokens}
        onApply={(spec) => {
          setDocument(appendWidget(document, spec));
        }}
      />
      <PropertyOverrideSheet
        open={overrideSheetOpen}
        onOpenChange={setOverrideSheetOpen}
        kind="equipment"
        slug={equipment.slug}
        label={equipment.label}
        rawContent={document}
        storageOverride={storageService.storage}
        onSaved={(targetNotebookId) => {
          if (targetNotebookId === 'notebook/custom') {
            void refresh();
            if (scopedNotebookId) {
              void navigate(equipmentPath(equipment.slug));
            }
          } else {
            void refresh();
            void navigate(`${equipmentPath(equipment.slug)}?notebook=${encodeURIComponent(targetNotebookId)}`);
          }
        }}
      />
    </div>
  );
}
