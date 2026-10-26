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

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';
import {
  ArrowLeftIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/20/solid';
import { Eye } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { Badge } from '@/components/atoms/primitives/badge';
import { Select } from '@/components/atoms/primitives/select';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { useTheme } from '@/contexts/ThemeProvider';
import { JournalPageShell } from '@/panels/page-shells';
import type { ScriptBlock } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import { useEffortContent } from '../hooks/useEffortContent';
import { useNotePageNav } from './shared/useNotePageNav';
import {
  NoteContextNav,
  noteOwnership,
  useNoteContextLinks,
} from './shared/noteContextLinks';
import { canGoBack } from './shared/pageUtils';
import { useScriptBlockCommands } from '../hooks/useScriptBlockCommands';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { EffortResolver, addAliasToEffort, type IEffort, type ResolvedEffort } from '@bitcobblers/wod-wiki-lang';
import { effortsPath, parseEffortRouteOptions, effortPath, dayPath } from '../lib/routes';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/atoms/primitives/toast';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import { shareBlock } from '../services/openInPlayground';
import { createJournalNoteFromWorkout } from '../services/journalWorkout';
import { CalendarCard } from '@/components/atoms/CalendarCard';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { effortToDocument, documentToEffort } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { ResponsiveActions } from '../nav/ResponsiveActions';
import { fileToDisplayName } from '@/repositories/groupings';

import { pendingRuntimes } from '../runtimeStore';
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
  const { slug } = useParams<{ slug: string }>();
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
    cloneForEdit,
    error,
    onLineChange,
    onBlur,
    flush,
  } = useEffortContent(slug);

  const [scriptBlocks, setScriptBlocks] = useState<ScriptBlock[]>([]);
  const [results] = useState<Session[]>([]);
  const [pendingScheduleBlock, setPendingScheduleBlock] = useState<ScriptBlock | null>(null);
  const [showResolved, setShowResolved] = useState(false);

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
  useNotePageNav({
    content: document,
    scriptBlocks,
    onStartWorkout: handleStartWorkout,
    results,
  });

  // ── Contextual links: back to the catalog (history state intact) + journal
  // copies stamped with /e/<slug> + workouts whose scripts use this effort.
  const ownerNoteId = effort?.ownerNoteId ?? `effort/${slug}`;
  const ownership = useMemo(
    () => slug ? noteOwnership({ id: ownerNoteId, type: 'note' }) : null,
    [slug, ownerNoteId],
  );
  const contextData = useNoteContextLinks({
    noteId: ownerNoteId,
    stamps: ownership?.stamps ?? [],
    effortSlug: slug,
  });

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

  if (isLoading) {
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
  const pageActions = (
    <ResponsiveActions primary={!isEditable ? (
      <Button variant="outline" onClick={handleClone} data-testid={TEST_IDS.EFFORT_DETAIL_CLONE_BTN}>
        <DocumentDuplicateIcon className="size-4 mr-1.5" />
        Clone
      </Button>
    ) : undefined}>
      <Button variant="ghost" size="icon" onClick={() => (canGoBack() ? navigate(-1) : navigate(effortsPath()))} aria-label="Back to catalog" title={canGoBack() ? 'Back' : 'Back to catalog'}>
        <ArrowLeftIcon className="size-4" />
      </Button>
      <Badge
        data-testid={TEST_IDS.EFFORT_DETAIL_SOURCE}
        variant={effort.registrySource === 'bundled' ? 'secondary' : 'default'}
      >
        {effort.registrySource === 'bundled' ? 'Bundled' : 'Custom'}
      </Badge>
      {resolved && (
        <Button
          variant={showResolved ? 'default' : 'outline'}
          onClick={() => setShowResolved(v => !v)}
        >
          <Eye className="size-4 mr-1.5" />
          {showResolved ? 'Hide Resolved' : 'Show Resolved'}
        </Button>
      )}
    </ResponsiveActions>
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
              commands={commands}
              onBlocksChange={setScriptBlocks}
            />
            <NoteContextNav data={contextData} up={ownership?.up} relatedLabel="Used in" />
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
    </div>
  );
}
