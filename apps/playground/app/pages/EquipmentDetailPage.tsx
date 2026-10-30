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
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DocumentDuplicateIcon } from '@heroicons/react/20/solid';
import { Button } from '@/components/atoms/primitives/button';
import { Badge } from '@/components/atoms/primitives/badge';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { useTheme } from '@/contexts/ThemeProvider';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import { useEquipmentContent, useEquipmentLinks, blankEquipmentDocument } from '../hooks/useEquipmentContent';
import { useNotePageNav } from './shared/useNotePageNav';
import { NoteContextNav, noteOwnership, useNoteContextLinks, noteLinkPath } from './shared/noteContextLinks';
import { useEquipmentRegistry } from '../contexts/EquipmentRegistryContext';
import { equipmentPath, effortPath, ROUTE_PATTERNS } from '../lib/routes';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';
import type { MenuSpec } from '../nav/menuModel';
import { toast } from '@/hooks/use-toast';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import { documentToEquipment } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { fileToDisplayName } from '@/repositories/groupings';

export function EquipmentDetailPage() {
  const { slug: slugParam, tag: tagParam } = useParams<{ slug?: string; tag?: string }>();
  const slug = slugParam ?? tagParam;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const actualTheme = theme === 'dark' ? 'dark' : 'vs';
  const { isReady, refresh } = useEquipmentRegistry();

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

  const previousSlugRef = useRef(equipment?.slug);
  useEffect(() => {
    const previous = previousSlugRef.current;
    if (equipment && previous && equipment.slug !== previous && equipment.registrySource === 'user') {
      navigate(equipmentPath(equipment.slug));
    }
    previousSlugRef.current = equipment?.slug;
  }, [equipment, navigate]);

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);

  // ── Create mode ("/equipment/new?mode=create" or "?mode=create" on any slug) ──
  const isCreateMode = searchParams.get('mode') === 'create';
  const [createDocument, setCreateDocument] = useState(() =>
    blankEquipmentDocument(slug && slug !== 'new' ? slug.trim().toLowerCase().replace(/\s+/g, '-') : ''),
  );

  const handleCreateSubmit = useCallback(async () => {
    const { equipment: parsed, errors } = documentToEquipment(createDocument);
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
        rawContent: createDocument,
        title: parsed.label.trim() || fileToDisplayName(slugValue),
        expectedSourceRevision: 0,
      });
      await refresh();
      navigate(equipmentPath(slugValue), { replace: true });
    } catch (err) {
      // Draft state is untouched — the document stays editable in the editor.
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save equipment.',
        variant: 'destructive',
      });
    }
  }, [createDocument, refresh, navigate]);

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
    helpfulActions: [
      ...(equipment && !isEditable ? [{ id: 'clone', label: 'Clone', onRun: () => void handleClone(), key: equipment.slug }] : []),
      { id: 'copy-link', label: 'Copy link', onRun: handleCopyLink },
    ],
  });

  // ── Contextual links + editor identity ride the ACTUAL owner note id —
  // never an invented `equipment/<slug>` when the projection carries one.
  const ownerNoteId = equipment?.ownerNoteId ?? (slug ? `equipment/${slug}` : '');
  const ownership = useMemo(
    () => (ownerNoteId ? noteOwnership({ id: ownerNoteId, type: 'collection' }) : null),
    [ownerNoteId],
  );
  const baseContext = useNoteContextLinks({
    noteId: ownerNoteId,
    stamps: ownership?.stamps ?? [],
  });
  const links = useEquipmentLinks(equipment?.slug);
  const contextData = useMemo(() => ({
    efforts: links.efforts.map(e => ({ id: e.slug, title: e.label, to: effortPath(e.slug) })),
    related: links.usedBy.map(u => ({ id: u.noteId, title: u.title, to: noteLinkPath(u.noteId) })),
    backlinks: baseContext.backlinks,
  }), [links, baseContext.backlinks]);
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
        navigate(equipmentPath(cloned.slug));
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
  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (isCreateMode) {
    const pageActions = (
      <ResponsiveActions
        primary={
          <Button onClick={handleCreateSubmit} data-testid={TEST_IDS.EQUIPMENT_CREATE_BTN}>
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
          title={slug && slug !== 'new' ? `New equipment: ${slug}` : 'New equipment'}
          actions={pageActions}
          editor={
            <div className="relative" data-testid="equipment-create-editor">
              <NoteEditor
                value={createDocument}
                onChange={setCreateDocument}
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
  // Whiteboard equipment sticky: Clone + Cast — Back became the L2 Up link
  // (NoteContextNav "Up" section).
  const pageActions = (
    <div className="flex items-center gap-2">
      <ResponsiveActions primary={!isEditable ? (
        <Button variant="outline" onClick={handleClone} data-testid={TEST_IDS.EQUIPMENT_DETAIL_CLONE_BTN}>
          <DocumentDuplicateIcon className="size-4 mr-1.5" />
          Clone
        </Button>
      ) : undefined}>
        <Badge
          data-testid={TEST_IDS.EQUIPMENT_DETAIL_SOURCE}
          variant={equipment.registrySource === 'bundled' ? 'secondary' : 'default'}
        >
          {equipment.registrySource === 'bundled' ? 'Bundled' : 'Custom'}
        </Badge>
      </ResponsiveActions>
      <CastButtonRpc />
    </div>
  );

  return (
    <div data-testid={TEST_IDS.EQUIPMENT_DETAIL_ROOT} className="contents">
      <JournalPageShell
        title={equipment.label}
        titleTestId={TEST_IDS.EQUIPMENT_DETAIL_LABEL}
        actions={pageActions}
        editor={
          <div className="relative" data-testid={TEST_IDS.EQUIPMENT_DETAIL_NOTEBOOK_EDITOR}>
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
            <NoteContextNav data={contextData} up={ownership?.up} relatedLabel="Used in" trailingSections={trailingSections} />
          </div>
        }
      />
    </div>
  );
}
