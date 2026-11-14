/**
 * EffortDetailPage — /effort/:slug
 *
 * Effort as a first-class note page. Uses the standard note format:
 *   - JournalPageShell with L1/L2/L3 navigation
 *   - NoteEditor for live markdown + wodwiki editing
 *   - YAML frontmatter rendered as a table view (via frontmatterPreview extension)
 *   - Real-time persistence: debounced save to IndexedDB + registry
 *   - IDB-first load with markdown file fallback
 *
 * Bundled efforts are read-only until first edit, which auto-clones them.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';
import {
  DocumentDuplicateIcon,
} from '@heroicons/react/20/solid';
import { Eye, Trash2 } from 'lucide-react';
import {
  listScopedPropertyOverrides,
  makeScopedOverrideId,
  notebookSlugFromId,
  saveScopedPropertyOverride,
  toNotebookId,
} from '@bitcobblers/wod-wiki-engine';
import { Button } from '@/components/atoms/primitives/button';
import { Badge } from '@/components/atoms/primitives/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/atoms/primitives/dialog';
import { Select } from '@/components/atoms/primitives/select';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { useTheme } from '@/contexts/ThemeProvider';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import { storageService } from '@/services/storage';
import { useEffortContent } from '../hooks/useEffortContent';
import { useEditorSave } from '../hooks/useEditorSave';
import { useNotePageNav } from './shared/useNotePageNav';
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks';
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { EffortResolver, addAliasToEffort, type IEffort, type ResolvedEffort } from '@bitcobblers/wod-wiki-lang';
import { effortsPath, parseEffortRouteOptions, effortPath, dayPath } from '../lib/routes';
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc';
import type { MenuSpec } from '../nav/menuModel';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/atoms/primitives/toast';
import { TEST_IDS } from '@/lib/testIds';
import { shareBlock } from '../services/openInPlayground';
import { createJournalNoteFromWorkout } from '../services/journalWorkout';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { effortToDocument, documentToEffort } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { fileToDisplayName } from '@/repositories/groupings';
import { appendWidget, resolveEntityScope } from '@bitcobblers/wod-wiki-wql';
import { queryService } from '@/services/queryService';
import { WidgetComposerDialog } from '../views/dashboards/WidgetComposerDialog';
import { pendingRuntimes } from '../runtimeStore';
import { PropertyOverrideSheet } from '@/components/organisms/notebook/PropertyOverrideSheet';
/* ── Resolved view (inline widget) ─────────────────────────────────────────── */

function EffortResolvedInline({ resolved, effort }: { resolved: ResolvedEffort; effort: IEffort }) {
  return (
    <div className="my-6 p-4 border rounded-lg bg-muted/30 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Eye className="size-4" />
        Effective Resolution
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase">Effective MET</p>
          <p className="text-xl font-bold">{resolved.met.toFixed(1)}</p>
          {Math.abs(resolved.met - (effort.baseAttributes.met || 0)) > 0.01 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (base: {effort.baseAttributes.met.toFixed(1)})
            </span>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">Discipline Factor</p>
          <p className="text-xl font-bold">{resolved.disciplineFactor.toFixed(2)}×</p>
        </div>
      </div>
      {Object.keys(resolved.modifiers).length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground uppercase mb-2">Applied Modifiers</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(resolved.modifiers).map(([key, value]) => (
              <Badge key={key} variant="outline">{key}: {value}</Badge>
            ))}
          </div>
        </div>
      )}
      {resolved.definition.derivation?.parentSlug && (
        <div className="border-t pt-3 text-sm">
          <p className="text-xs text-muted-foreground uppercase mb-1">Parent</p>
          <span className="font-mono text-primary">{resolved.definition.derivation.parentSlug}</span>
        </div>
      )}
    </div>
  );
}

/* ── Main page component ──────────────────────────────────────────────────── */

export function EffortDetailPage() {
  const { slug: slugParam, tag: tagParam } = useParams<{ slug?: string; tag?: string }>();
  const slug = slugParam ?? tagParam;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const actualTheme = theme === 'dark' ? 'dark' : 'vs';
  const { registry, isReady, refresh } = useEffortRegistry();

  const {
    document,
    setDocument,
    isLoading,
    effort,
    isEditable,
    notFound,
    remove,
    cloneForEdit,
    error,
    onLineChange,
    onBlur,
    flush,
  } = useEffortContent(slug);

  const rawNotebookParam = searchParams.get('notebook')?.trim() ?? '';
  const scopedNotebookId = useMemo(() => {
    if (!rawNotebookParam) return null;
    const normalized = toNotebookId(rawNotebookParam);
    return normalized === 'notebook/custom' ? null : normalized;
  }, [rawNotebookParam]);

  const [scopedDocument, setScopedDocumentState] = useState<string>('');
  const [scopedLoadedKey, setScopedLoadedKey] = useState<string | null>(null);
  const [scopedOwnerNoteId, setScopedOwnerNoteId] = useState<string | null>(null);
  const expectedScopedKey = scopedNotebookId && slug ? `${scopedNotebookId}::${slug}` : null;
  const isScopedPending = Boolean(expectedScopedKey && scopedLoadedKey !== expectedScopedKey);

  useEffect(() => {
    if (!scopedNotebookId || !slug || !expectedScopedKey) {
      setScopedLoadedKey(null);
      setScopedOwnerNoteId(null);
      return;
    }
    let cancelled = false;
    listScopedPropertyOverrides(storageService.storage, {
      notebookId: scopedNotebookId,
      kind: 'effort',
      slug,
    })
      .then((rows) => {
        if (cancelled) return;
        const row = rows[0];
        if (row) {
          setScopedDocumentState(row.rawContent);
          setScopedOwnerNoteId(row.ownerNoteId);
          setScopedLoadedKey(expectedScopedKey);
        } else if (document) {
          setScopedDocumentState(document);
          setScopedOwnerNoteId(`override/${notebookSlugFromId(scopedNotebookId)}/effort/${slug}`);
          setScopedLoadedKey(expectedScopedKey);
        }
      })
      .catch(() => {
        if (!cancelled) setScopedLoadedKey(expectedScopedKey);
      });
    return () => {
      cancelled = true;
    };
  }, [scopedNotebookId, slug, expectedScopedKey, document]);

  const handleSaveScopedOverride = useCallback(
    async (value: string) => {
      if (!scopedNotebookId || !effort || !value.trim()) return;
      const { effort: parsed, errors } = documentToEffort(value, effort);
      if (errors.length > 0) {
        toast({
          title: 'Invalid YAML',
          description: errors.join('\n'),
          variant: 'destructive',
        });
        return;
      }
      const saved = await saveScopedPropertyOverride(storageService.storage, {
        targetNotebookId: scopedNotebookId,
        kind: 'effort',
        slug: effort.slug,
        rawContent: value,
        title: parsed.label.trim() || effort.label,
      });
      setScopedOwnerNoteId(saved.ownerNoteId);
    },
    [scopedNotebookId, effort],
  );

  const {
    onChange: onScopedChange,
    onLineChange: onScopedLineChange,
    onBlur: onScopedBlur,
    flush: flushScoped,
  } = useEditorSave({
    onSave: handleSaveScopedOverride,
  });

  const setScopedDocument = useCallback(
    (value: string) => {
      setScopedDocumentState(value);
      onScopedChange(value);
    },
    [onScopedChange],
  );

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingEffort, setDeletingEffort] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isDeletingRef = useRef(false);

  const activeDocument = scopedNotebookId ? scopedDocument : document;
  const activeSetDocument = scopedNotebookId ? setScopedDocument : setDocument;
  const activeOnLineChange = scopedNotebookId ? onScopedLineChange : onLineChange;
  const activeOnBlur = useCallback(() => {
    if (isDeletingRef.current) return;
    if (scopedNotebookId) {
      onScopedBlur();
    } else {
      onBlur();
    }
  }, [scopedNotebookId, onScopedBlur, onBlur]);
  const activeFlush = useCallback(() => {
    if (isDeletingRef.current) return Promise.resolve();
    return scopedNotebookId ? flushScoped() : flush();
  }, [scopedNotebookId, flushScoped, flush]);
  const activeIsEditable = Boolean(scopedNotebookId) || isEditable;

  const handleConfirmDelete = useCallback(async () => {
    if (!effort || deletingEffort) return;
    setDeletingEffort(true);
    setDeleteError(null);
    isDeletingRef.current = true;
    try {
      if (scopedNotebookId) {
        const overrideId = makeScopedOverrideId(scopedNotebookId, 'effort', effort.slug);
        const targetOwnerNoteId =
          scopedOwnerNoteId ?? `override/${notebookSlugFromId(scopedNotebookId)}/effort/${effort.slug}`;
        await storageService.storage.transaction(
          ['notes', 'property_overrides'],
          'readwrite',
          async (tx) => {
            await tx.readwrite('property_overrides').delete(overrideId);
            await tx.readwrite('notes').delete(targetOwnerNoteId);
          },
        );
        await refresh();
        setConfirmDeleteOpen(false);
        toast({
          title: 'Override deleted',
          description: `Removed the ${notebookSlugFromId(scopedNotebookId)} override for "${effort.label}".`,
        });
        navigate(effortPath(effort.slug), { replace: true });
        return;
      }

      if (effort.sourceId === 'notebook/custom' || effort.ownerNoteId?.startsWith('override/')) {
        const overrideId = makeScopedOverrideId('notebook/custom', 'effort', effort.slug);
        const targetOwnerNoteId = effort.ownerNoteId ?? `override/custom/effort/${effort.slug}`;
        await storageService.storage.transaction(
          ['notes', 'property_overrides'],
          'readwrite',
          async (tx) => {
            await tx.readwrite('property_overrides').delete(overrideId);
            await tx.readwrite('notes').delete(targetOwnerNoteId);
          },
        );
        await refresh();
      } else {
        await remove();
      }
      setConfirmDeleteOpen(false);
      toast({
        title: 'Effort deleted',
        description: `Deleted custom effort "${effort.label}".`,
      });
      navigate(effortsPath(), { replace: true });
    } catch (err) {
      isDeletingRef.current = false;
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete effort.');
    } finally {
      setDeletingEffort(false);
    }
  }, [effort, deletingEffort, scopedNotebookId, scopedOwnerNoteId, refresh, remove, navigate]);

  const previousSlugRef = useRef(effort?.slug);
  useEffect(() => {
    const previous = previousSlugRef.current;
    if (effort && previous && effort.slug !== previous && effort.registrySource === 'user') {
      navigate(effortPath(effort.slug));
    }
    previousSlugRef.current = effort?.slug;
  }, [effort, navigate]);

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);
  const [results] = useState<Session[]>([]);
  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [widgetComposerOpen, setWidgetComposerOpen] = useState(false);
  const [overrideSheetOpen, setOverrideSheetOpen] = useState(false);
  const effortScope = useMemo(
    () => (slug ? resolveEntityScope({ kind: 'effort', slug, label: effort?.label ?? slug }) : null),
    [slug, effort?.label],
  );
  // ── Create-custom mode ("/effort/new?mode=create") ───────────────────────
  const opts = parseEffortRouteOptions(searchParams);
  const isCreateMode = opts.mode === 'create';
  const [createDocument, setCreateDocument] = useState(() => {
    const initialSlug = slug && slug !== 'new' ? slug.trim().toLowerCase().replace(/\s+/g, '-') : '';
    const initialLabel = initialSlug ? fileToDisplayName(initialSlug) : '';
    const blank: IEffort = {
      id: `effort-user-${crypto.randomUUID()}`,
      slug: initialSlug,
      label: initialLabel,
      aliases: initialSlug ? [initialSlug.replace(/[-_]+/g, ' ')] : [],
      baseAttributes: { met: 5.0 },
      registrySource: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return effortToDocument(blank);
  });
  const [showAliasLinking, setShowAliasLinking] = useState(false);
  const [selectedTargetSlug, setSelectedTargetSlug] = useState<string>('');
  const existingEfforts = useMemo(() => {
    if (!registry) return [];
    return [...registry.list()].sort((a, b) => a.label.localeCompare(b.label));
  }, [registry]);

  const handleLinkAlias = useCallback(async () => {
    if (!slug || !selectedTargetSlug || !registry) return;
    try {
      await addAliasToEffort(registry, selectedTargetSlug, slug);
      await refresh();
      toast({
        title: 'Alias Linked',
        description: `Linked "${slug}" as an alias to ${selectedTargetSlug}.`,
      });
      navigate(effortPath(selectedTargetSlug));
    } catch (err) {
      toast({
        title: 'Failed to link alias',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [slug, selectedTargetSlug, registry, refresh, navigate]);

  const handleCreateSubmit = useCallback(async () => {
    const { effort: parsed, errors } = documentToEffort(createDocument);
    if (errors.length > 0) {
      toast({
        title: 'Invalid YAML',
        description: errors.join('\n'),
        variant: 'destructive',
      });
      return;
    }

    // The slug in the document IS the projection identity — validate it, never
    // silently commit a normalized rewrite that diverges from the source.
    const slugValue = parsed.slug.trim();
    if (!slugValue) {
      toast({
        title: 'Missing slug',
        description: 'A unique slug is required.',
        variant: 'destructive',
      });
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
      // One atomic commit: source note + definition projection + links.
      await commitReferenceNote({
        kind: 'effort',
        slug: slugValue,
        rawContent: createDocument,
        title: parsed.label.trim() || fileToDisplayName(slugValue),
        expectedSourceRevision: 0,
      });
      await refresh();
      navigate(effortPath(slugValue), { replace: true });
    } catch (err) {
      // Draft stays intact and editable on failure.
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save effort.',
        variant: 'destructive',
      });
    }
  }, [createDocument, refresh, navigate]);

  // Resolve effort for the inline "resolved" widget
  const resolver = useMemo(() => new EffortResolver(registry), [registry]);
  const resolved = useMemo((): ResolvedEffort | null => {
    if (!effort || !isReady) return null;
    return resolver.resolveEffort(effort.slug);
  }, [effort, isReady, resolver]);

  // ── WOD block handlers ───────────────────────────────────────────────────
  const handleStartWorkout = useCallback(async (block: ScriptBlock) => {
    try {
      const note = await createJournalNoteFromWorkout({ workoutName: effort?.label ?? slug ?? 'Effort', category: 'effort', sourceNotePath: effortPath(slug ?? ''), wodContent: block.content });
      const occurrence = Object.values(note.blocks ?? {}).find(candidate => candidate.kind === 'wod');
      if (!occurrence) throw new Error('The saved journal workout is unavailable.');
      const runtimeId = uuidv7();
      pendingRuntimes.set(runtimeId, { block: { ...block, id: occurrence.id }, noteId: note.id });
      navigate(`/run/${runtimeId}`);
    } catch (error) {
      toast({ title: 'Workout not started', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  }, [slug, effort?.label, navigate]);

  const handleScheduleBlock = useCallback(async (block: ScriptBlock, date: Date) => {
    if (!effort) return;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    try {
      await createJournalNoteFromWorkout({
        workoutName: effort.label,
        category: 'effort',
        sourceNoteLabel: effort.label,
        sourceNotePath: effortPath(effort.slug),
        wodContent: block.content,
        date,
      });
      navigate(dayPath(dateKey));
      toast({
        title: 'Scheduled',
        description: `Added to journal for ${dateKey}`,
        action: (
          <ToastAction altText="Open journal" onClick={() => navigate(dayPath(dateKey))}>
            Open
          </ToastAction>
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Could not schedule workout', variant: 'destructive' });
    }
  }, [effort, navigate]);

  // ── L3 nav from document content ─────────────────────────────────────────
  // Whiteboard effort L3: Clone (read-only), Show Resolved, Copy link after
  // the outline. `key` republishes when the effort loads so Clone's closure
  // never stays null.
  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href)
  }, [])
  useNotePageNav({
    content: activeDocument,
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
    results,
    enableUnrecognizedActions: false,
    helpfulActions: [
      ...(effort && !activeIsEditable ? [{ id: 'clone', label: 'Clone', onRun: () => void handleClone(), key: effort.slug }] : []),
      ...(effort ? [{ id: 'add-widget', label: 'Add widget', onRun: () => setWidgetComposerOpen(true) }] : []),
      ...(resolved ? [{ id: 'show-resolved', label: showResolved ? 'Hide Resolved' : 'Show Resolved', onRun: () => setShowResolved(v => !v) }] : []),
      ...(effort && activeIsEditable ? [{ id: 'delete', label: 'Delete', onRun: () => setConfirmDeleteOpen(true), key: `${effort.slug}:delete` }] : []),
      { id: 'copy-link', label: 'Copy link', onRun: handleCopyLink },
    ],
  });

  // ── Contextual links: back to the catalog (history state intact) + journal
  // copies stamped with /e/<slug> + workouts whose scripts use this effort.
  const ownerNoteId = scopedNotebookId
    ? (scopedOwnerNoteId ?? `override/${notebookSlugFromId(scopedNotebookId)}/effort/${slug}`)
    : (effort?.ownerNoteId ?? `effort/${slug}`);
  const ownership = useMemo(
    () => slug ? noteOwnership({ id: ownerNoteId, type: 'note' }) : null,
    [slug, ownerNoteId],
  );
  const contextData = useNoteContextLinks({
    noteId: ownerNoteId,
    stamps: ownership?.stamps ?? [],
    effortSlug: slug,
  });
  // Whiteboard effort L2: recent efforts last.
  const trailingSections = useMemo<MenuSpec>(() => [
    {
      kind: 'wql',
      id: 'recent-efforts',
      label: 'Recent efforts',
      query: ':effort{}',
      limit: 5,
      toEntry: (e) => effortPath(e.effort?.slug ?? e.id),
      filterEntry: (e) => (e.effort?.slug ?? e.id) !== slug,
    },
  ], [slug]);

  // ── WOD block commands ───────────────────────────────────────────────────
  const commands = useScriptBlockCommands('notebook-readonly', {
    onPlay: handleStartWorkout,
    onShare: shareBlock,
    onSchedule: setPendingScheduleBlock,
  });

  // ── Page title ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (effort) {
      window.document.title = `Wod.Wiki - ${effort.label}`;
    }
  }, [effort]);

  // ── Handle clone for edit ────────────────────────────────────────────────
  const handleClone = useCallback(async () => {
    if (!effort) return;
    try {
      // cloneForEdit awaits the persisted copy commit — navigate only after.
      const cloned = await cloneForEdit();
      if (cloned) {
        navigate(effortPath(cloned.slug));
        toast({
          title: 'Cloned',
          description: `Created a custom copy of "${effort.label}". You can now edit it.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Clone failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [cloneForEdit, effort, navigate]);

  // ── Loading / error states ───────────────────────────────────────────────
  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (isCreateMode) {
    // Reserved slug collision: a real effort literally named "new" collides with
    // this create-form route. The form mints a fresh id/slug on save, so the
    // only collision is the URL path itself (unavoidable for any hard-coded
    // create alias).
    const createActions = (
      <ResponsiveActions primary={(
        <Button onClick={handleCreateSubmit} data-testid="effort-create-btn">
          Create Effort
        </Button>
      )}>
        <Button variant="outline" onClick={() => navigate(effortsPath())}>
          Cancel
        </Button>
      </ResponsiveActions>
    );
    return (
      <div data-testid={TEST_IDS.EFFORT_DETAIL_ROOT} className="contents">
        <JournalPageShell
          title={slug && slug !== 'new' ? `New effort: ${slug}` : 'Create Custom Effort'}
          actions={createActions}
          editor={
            <div className="relative" data-testid="effort-create-editor">
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
                commands={commands}
                onBlocksChange={setScriptBlocks}
              />
            </div>
          }
        />
      </div>
    );
  }

  if (isLoading || isScopedPending) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (error) {
    // A storage/load failure must not masquerade as "not found" (which offers
    // to create a colliding definition).
    return (
      <div data-testid="effort-load-error" className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center max-w-lg mx-auto">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Effort could not be loaded</h2>
          <p className="text-sm text-destructive">{error}</p>
        </div>
        <Button variant="outline" onClick={() => navigate(effortsPath())}>
          Back to library
        </Button>
      </div>
    );
  }

  if (notFound || !effort) {
    return (
      <div data-testid={TEST_IDS.EFFORT_NOT_FOUND} className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center max-w-lg mx-auto">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Effort &ldquo;{slug}&rdquo; not found</h2>
          <p className="text-sm text-muted-foreground">
            This movement has not been populated in the effort catalog yet. You can create a new definition page for it or link it as an alias to an existing effort.
          </p>
        </div>

        {!showAliasLinking ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => navigate(effortPath(slug!, undefined, { mode: 'create' }))}
              data-testid={TEST_IDS.EFFORT_NOT_FOUND_CREATE_BTN}
            >
              Create Effort Page
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowAliasLinking(true);
                if (existingEfforts.length > 0 && !selectedTargetSlug) {
                  setSelectedTargetSlug(existingEfforts[0].slug);
                }
              }}
              data-testid={TEST_IDS.EFFORT_NOT_FOUND_ALIAS_BTN}
            >
              Link as Alias
            </Button>
            <Button variant="outline" onClick={() => navigate(effortsPath())}>
              Back to library
            </Button>
          </div>
        ) : (
          <div className="w-full space-y-4 p-4 border rounded-lg bg-card text-left">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Select target effort for &ldquo;{slug}&rdquo;:
              </label>
              <Select
                value={selectedTargetSlug}
                onChange={(e) => setSelectedTargetSlug(e.target.value)}
                data-testid={TEST_IDS.EFFORT_NOT_FOUND_ALIAS_SELECT}
              >
                {existingEfforts.map((e) => (
                  <option key={e.slug} value={e.slug}>
                    {e.label} ({e.slug})
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAliasLinking(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleLinkAlias}
                disabled={!selectedTargetSlug}
                data-testid={TEST_IDS.EFFORT_NOT_FOUND_ALIAS_CONFIRM}
              >
                Confirm Link
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Actions bar (rendered by JournalPageShell actions prop) ──────────────
  // Whiteboard effort sticky: Clone, Show Resolved, Cast — Back became the
  // L2 Up link (NoteContextNav "Up" section).
  const pageActions = (
    <div className="flex items-center gap-2">
      <ResponsiveActions primary={!activeIsEditable ? (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="default"
            onClick={() => setOverrideSheetOpen(true)}
            data-testid="effort-detail-override-btn"
          >
            Override
          </Button>
          <Button type="button" variant="outline" onClick={handleClone} data-testid={TEST_IDS.EFFORT_DETAIL_CLONE_BTN}>
            <DocumentDuplicateIcon className="size-4 mr-1.5" />
            Clone
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOverrideSheetOpen(true)}
            data-testid="effort-detail-override-btn"
          >
            Override Scope
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteError(null);
              setConfirmDeleteOpen(true);
            }}
            data-testid={TEST_IDS.EFFORT_DETAIL_DELETE_BTN}
          >
            <Trash2 className="size-4 mr-1.5" />
            Delete
          </Button>
        </div>
      )}>
        <Badge
          data-testid={TEST_IDS.EFFORT_DETAIL_SOURCE}
          variant={!activeIsEditable ? 'secondary' : 'default'}
        >
          {scopedNotebookId
            ? `Scoped · ${notebookSlugFromId(scopedNotebookId)}`
            : effort.registrySource === 'bundled'
              ? 'Bundled'
              : 'Custom'}
        </Badge>
        {scopedNotebookId && (
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(effortPath(effort.slug))}
            data-testid="effort-detail-global-link"
          >
            Global Definition
          </Button>
        )}
        {resolved && (
          <Button
            type="button"
            variant={showResolved ? 'default' : 'outline'}
            onClick={() => setShowResolved(v => !v)}
          >
            <Eye className="size-4 mr-1.5" />
            {showResolved ? 'Hide Resolved' : 'Show Resolved'}
          </Button>
        )}
      </ResponsiveActions>
      <CastButtonRpc />
    </div>
  );

  const noteId = ownerNoteId;


  return (
    <div data-testid={TEST_IDS.EFFORT_DETAIL_ROOT} className="contents">
      <JournalPageShell
        title={effort.label}
        titleTestId={TEST_IDS.EFFORT_DETAIL_LABEL}
        actions={pageActions}
        editor={
          <div className="relative" data-testid={TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR}>
            {/* Resolved view inline widget */}
            {showResolved && resolved && (
              <div className="px-6 lg:px-10 pt-4">
                <EffortResolvedInline resolved={resolved} effort={effort} />
              </div>
            )}
            <NoteEditor
              noteId={noteId}
              value={activeDocument}
              onChange={activeSetDocument}
              onCursorPositionChange={activeOnLineChange}
              onBlur={activeOnBlur}
              onSaveRequest={activeFlush}
              onCommitChange={activeFlush}
              theme={actualTheme}
              readonly={false}
              showLineNumbers={true}
              enablePreview={true}
              enableLinting={true}
              enableOverlay={true}
              mode="edit"
              commands={commands}
              onBlocksChange={setScriptBlocks}
            />
            <NoteContextNav data={contextData} up={ownership?.up} relatedLabel="Used in" trailingSections={trailingSections} />
          </div>
        }
      />

      {/* Schedule modal */}
      {pendingScheduleBlock && (
        <EditorDialog
          open
          onClose={() => setPendingScheduleBlock(null)}
          title="Schedule workout"
        >
            <CalendarCard
              selectedDate={null}
              onDateSelect={(date) => {
                handleScheduleBlock(pendingScheduleBlock, date);
                setPendingScheduleBlock(null);
              }}
            />
        </EditorDialog>
      )}
      <WidgetComposerDialog
        open={widgetComposerOpen}
        onClose={() => setWidgetComposerOpen(false)}
        mode="add"
        initialWql={effortScope ? `sum:totalVolume{${effortScope.scopeFilter}} by {week}` : 'sum:totalVolume{} by {week}'}
        subsetQuery={effortScope?.notesWql ?? null}
        executor={queryService}
        tokenValues={effortScope?.tokens}
        onApply={(spec) => {
          activeSetDocument(appendWidget(activeDocument, spec));
        }}
      />
      <PropertyOverrideSheet
        open={overrideSheetOpen}
        onOpenChange={setOverrideSheetOpen}
        kind="effort"
        slug={effort.slug}
        label={effort.label}
        rawContent={activeDocument}
        onSaved={(targetNotebookId) => {
          if (targetNotebookId === 'notebook/custom') {
            void refresh();
            if (scopedNotebookId) {
              navigate(effortPath(effort.slug));
            }
          } else {
            navigate(`${effortPath(effort.slug)}?notebook=${encodeURIComponent(targetNotebookId)}`);
          }
        }}
      />
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!deletingEffort) {
            setConfirmDeleteOpen(open);
            if (!open) setDeleteError(null);
          }
        }}
      >
        <DialogContent data-testid="effort-delete-dialog">
          <DialogHeader>
            <DialogTitle>{scopedNotebookId ? 'Delete scoped override?' : 'Delete custom effort?'}</DialogTitle>
            <DialogDescription>
              {scopedNotebookId
                ? `Remove the ${notebookSlugFromId(scopedNotebookId)} override for "${effort.label}"? The bundled catalog definition remains untouched.`
                : `Permanently delete custom effort "${effort.label}"? Bundled efforts and your workout sessions remain untouched.`}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingEffort}
              onClick={() => {
                setConfirmDeleteOpen(false);
                setDeleteError(null);
              }}
              data-testid="effort-delete-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingEffort}
              aria-busy={deletingEffort}
              onClick={() => {
                void handleConfirmDelete();
              }}
              data-testid="effort-delete-confirm"
            >
              {deletingEffort ? 'Deleting…' : scopedNotebookId ? 'Delete override' : 'Delete effort'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
