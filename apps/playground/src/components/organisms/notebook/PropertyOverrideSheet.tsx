import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
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
      for (const n of allNotes) {
        if (isPublishableNotebookLanding(n)) {
          const nbId = toNotebookId(n.id);
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

  if (!open) return null;

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

  const handleCreateAndOverride = async (e: FormEvent) => {
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

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/25"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Override ${label}`}
        data-testid="property-override-sheet"
        onClick={(e) => e.stopPropagation()}
        className="w-full lg:max-w-md max-h-[85dvh] overflow-y-auto rounded-t-xl lg:rounded-xl border border-[#EAEAEA] dark:border-zinc-800 bg-[#FFFFFF] dark:bg-zinc-950 text-[#111111] dark:text-zinc-100 p-5 sm:p-6 space-y-5"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[#EAEAEA] dark:bg-zinc-800 lg:hidden" />

        <div className="flex items-start justify-between gap-3 border-b border-[#EAEAEA] dark:border-zinc-800 pb-3.5">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold tracking-tight">Override {label}</h3>
            <p className="font-mono text-[11px] text-[#787774]">
              Canonical slug: {slug}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close override sheet"
            className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-md border border-[#EAEAEA] dark:border-zinc-800 text-xs font-mono text-[#787774] hover:text-[#111111]"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Option 1: Personal Runtime (`notebook/custom`) */}
        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#787774]">
            Personal Runtime
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSelectTarget('notebook/custom')}
            data-testid="override-target-notebook/custom"
            className="w-full min-h-12 text-left rounded-lg border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900 hover:border-[#111111] p-3.5 transition-colors flex items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">My Custom Runtime (notebook/custom)</div>
              <div className="text-[11px] text-[#787774]">
                Processes workouts in your personal runtime using this definition on the same canonical slug.
              </div>
            </div>
            {customHasOverride && (
              <span className="shrink-0 rounded-full bg-[#EDF3EC] text-[#346538] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                Active
              </span>
            )}
          </button>
        </div>

        {/* Option 2: Shared User Notebooks */}
        <div className="space-y-2 border-t border-[#EAEAEA] dark:border-zinc-800 pt-4">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#787774]">
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
                  className="w-full min-h-11 text-left rounded-lg border border-[#EAEAEA] dark:border-zinc-800 hover:border-[#111111] px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-medium">{nb.title}</div>
                    <div className="font-mono text-[10px] text-[#787774]">notebook/{nb.slug}</div>
                  </div>
                  {nb.hasExistingOverride && (
                    <span className="rounded-full bg-[#E1F3FE] text-[#1F6C9F] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                      Overridden
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void handleCreateAndOverride(e)} className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newNotebookName}
              onChange={(e) => setNewNotebookName(e.target.value)}
              placeholder="Override in new Notebook..."
              aria-label="New shared Notebook name"
              data-testid="override-new-notebook-input"
              className="min-h-11 flex-1 rounded-md border border-[#EAEAEA] dark:border-zinc-800 bg-[#FBFBFA] dark:bg-zinc-900 px-3 text-xs focus:outline-none focus:border-[#111111]"
            />
            <button
              type="submit"
              disabled={busy || !newNotebookName.trim()}
              data-testid="override-new-notebook-submit"
              className="min-h-11 rounded-md bg-[#111111] text-white px-3.5 text-xs font-medium disabled:opacity-40 hover:bg-[#333333] transition-colors"
            >
              Save
            </button>
          </form>
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
