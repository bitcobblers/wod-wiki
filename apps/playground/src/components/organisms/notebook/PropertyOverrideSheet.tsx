import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  isNonPublishableNotebook,
  isPublishableNotebookLanding,
  notebookSlugFromId,
  toNotebookId,
  type NotebookId,
  type OverridePropertyKind,
} from '@bitcobblers/wod-wiki-core';
import {
  createUserNotebookLanding,
  listScopedPropertyOverrides,
  saveScopedPropertyOverride,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import {
  Button,
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  Input,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { X } from 'lucide-react';
import { storage } from '@/hooks/useBrowserServices';
import { toast } from '@/hooks/use-toast';

export interface PropertyOverrideSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: OverridePropertyKind;
  slug: string;
  label: string;
  rawContent: string;
  storageOverride?: IStorage;
  onSaved?: (targetNotebookId: string) => void;
}

interface TargetNotebookItem {
  id: NotebookId;
  slug: string;
  title: string;
  hasExistingOverride: boolean;
}

export function PropertyOverrideSheet({
  open,
  onOpenChange,
  kind,
  slug,
  label,
  rawContent,
  storageOverride,
  onSaved,
}: PropertyOverrideSheetProps) {
  const activeStorage = storageOverride ?? storage;
  const [targets, setTargets] = useState<TargetNotebookItem[]>([]);
  const [customHasOverride, setCustomHasOverride] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTargets = useCallback(async () => {
    try {
      const [allNotes, overrides] = await Promise.all([
        activeStorage.readonly('notes').getAll(),
        listScopedPropertyOverrides(activeStorage, { kind, slug }),
      ]);
      const overriddenNotebooks = new Set(overrides.map((o) => o.notebookId));
      setCustomHasOverride(overriddenNotebooks.has('notebook/custom'));

      const rows: TargetNotebookItem[] = [];
      const seen = new Set<string>(['notebook/custom']);
      for (const n of allNotes) {
        const isTargetNotebook =
          isPublishableNotebookLanding(n) ||
          (n.id.startsWith('notebook/') &&
            n.type === 'notebook' &&
            !isNonPublishableNotebook(n.id) &&
            n.feedOrigin !== 'feed' &&
            n.seedOrigin !== 'seed');
        if (isTargetNotebook) {
          const nbId = toNotebookId(n.id);
          if (seen.has(nbId)) continue;
          seen.add(nbId);
          rows.push({
            id: nbId,
            slug: notebookSlugFromId(nbId),
            title: n.title || notebookSlugFromId(nbId),
            hasExistingOverride: overriddenNotebooks.has(nbId),
          });
        }
      }
      setTargets(rows);
    } catch {
      // Ignore transient errors
    }
  }, [activeStorage, kind, slug]);

  useEffect(() => {
    if (open) {
      void loadTargets();
    }
  }, [open, loadTargets]);

  const handleSelectTarget = async (targetNotebookId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveScopedPropertyOverride(activeStorage, {
        targetNotebookId,
        kind,
        slug,
        rawContent,
        title: label,
      });
      toast({
        title: 'Override saved',
        description:
          targetNotebookId === 'notebook/custom'
            ? `Saved '${slug}' to your personal Custom runtime.`
            : `Scoped '${slug}' override to ${targetNotebookId}.`,
      });
      onSaved?.(targetNotebookId);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Could not save override',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndOverride = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = newNotebookName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const nbId = await createUserNotebookLanding(activeStorage, trimmed);
      setNewNotebookName('');
      setBusy(false);
      await handleSelectTarget(nbId);
    } catch (err) {
      setBusy(false);
      toast({
        title: 'Could not create Notebook',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerBackdrop className="bg-black/30" />
      <DrawerContent
        initialFocus="content"
        aria-label={`Override ${label}`}
        data-testid="property-override-sheet"
        className="w-full lg:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-xl border border-border bg-card text-foreground p-5 sm:p-6 space-y-5"
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border lg:hidden" />

        <div className="flex items-start justify-between gap-3 border-b border-border pb-3.5">
          <div className="space-y-0.5">
            <DrawerTitle className="text-sm font-semibold tracking-tight">
              Override {label}
            </DrawerTitle>
            <DrawerDescription className="font-mono text-[11px] text-muted-foreground">
              Canonical slug: {slug}
            </DrawerDescription>
          </div>
          <DrawerClose
            aria-label="Close override sheet"
            className="min-h-9 min-w-9 h-auto w-auto p-0 inline-flex items-center justify-center rounded-md border border-border bg-transparent text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </DrawerClose>
        </div>

        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Personal Runtime
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSelectTarget('notebook/custom')}
            data-testid="override-target-notebook/custom"
            className="w-full min-h-12 text-left rounded-lg border border-border bg-muted/30 hover:border-foreground p-3.5 transition-colors flex items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">My Custom Runtime (notebook/custom)</div>
              <div className="text-[11px] text-muted-foreground">
                Processes workouts in your personal runtime using this definition on the same canonical slug.
              </div>
            </div>
            {customHasOverride && (
              <span className="shrink-0 rounded-full bg-success/15 text-success px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                Active
              </span>
            )}
          </button>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Shared User Notebooks (Promoted on Publish)
          </span>

          {targets.length > 0 && (
            <div className="space-y-1.5">
              {targets.map((nb) => (
                <button
                  key={nb.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSelectTarget(nb.id)}
                  data-testid={`override-target-${nb.id}`}
                  className="w-full min-h-11 text-left rounded-lg border border-border hover:border-foreground px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-medium">{nb.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">notebook/{nb.slug}</div>
                  </div>
                  {nb.hasExistingOverride && (
                    <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider">
                      Overridden
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void handleCreateAndOverride(e)} className="flex items-center gap-2 pt-1">
            <Input
              type="text"
              value={newNotebookName}
              onValueChange={setNewNotebookName}
              placeholder="Override in new Notebook..."
              aria-label="New shared Notebook name"
              data-testid="override-new-notebook-input"
              className="min-h-11 h-11 flex-1 text-xs"
            />
            <Button
              type="submit"
              disabled={busy || !newNotebookName.trim()}
              data-testid="override-new-notebook-submit"
              className="min-h-11 px-3.5 text-xs"
            >
              Save
            </Button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
