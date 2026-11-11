/**
 * CreateReferenceFromLabelDialog — In-place creation modal for turning an
 * unrecognized label on a note page into a canonical Effort, Equipment, or Tag
 * without losing the user's editing context.
 *
 * Commits atomically via `commitReferenceNote`, refreshes the corresponding
 * in-memory registry (`EffortRegistry`, `EquipmentRegistry`, `tagCatalogue`),
 * rebuilds the open note's containment index when stored, and broadcasts
 * `notifyReferenceCatalogChanged()` so both L2 and L3 immediately promote the
 * label from unrecognized to a recognized 2-part link.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { effortToDocument, equipmentToDocument, slugifyRefLabel, type IEffort } from '@bitcobblers/wod-wiki-lang';
import { Button } from '@/components/atoms/primitives/button';
import { Input } from '@/components/atoms/primitives/input';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { DEFAULT_TAG_TYPES } from '@/services/storage/StorageService';
import { storageService } from '@/services/storage';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';
import { toast } from '@/hooks/use-toast';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '@/services/effortRegistry';
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { useOptionalEffortRegistry } from '../../../contexts/EffortRegistryContext';
import { useOptionalEquipmentRegistry } from '../../../contexts/EquipmentRegistryContext';
import { buildTagNoteDocument } from '../../../hooks/usePropertyNote';
import { effortPath, equipmentPath, tagPath } from '../../../lib/routes';
import {
  notifyReferenceCatalogChanged,
  type UnrecognizedFacet,
} from '../../../pages/shared/useLiveNoteFacets';

export type CreatableReferenceKind = 'effort' | 'equipment' | 'tag';

export interface CreateReferenceRequest {
  item: UnrecognizedFacet;
  /** Optional owning note id so `rebuildBlockIndexForNote` updates stored containment immediately. */
  noteId?: string;
}

const hostListeners = new Set<(req: CreateReferenceRequest | null) => void>();

/** Imperatively open the shared Create Reference dialog from any L2 or L3 item. */
export function openCreateReferenceDialog(req: CreateReferenceRequest): void {
  for (const listener of hostListeners) listener(req);
}

function titleCaseFromLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildStarterEffortDocument(slug: string, label: string, rawAlias: string): string {
  const aliases =
    rawAlias.trim() && rawAlias.trim().toLowerCase() !== label.trim().toLowerCase()
      ? [rawAlias.trim()]
      : [];
  const now = new Date().toISOString();
  const effort: IEffort = {
    id: `effort-user-${crypto.randomUUID()}`,
    slug,
    label,
    aliases,
    baseAttributes: { met: 5.0 },
    registrySource: 'user',
    createdAt: now,
    updatedAt: now,
  };
  return effortToDocument(effort);
}

export interface CreateReferenceFromLabelDialogProps {
  open: boolean;
  onClose: () => void;
  item: UnrecognizedFacet | null;
  noteId?: string;
  onCreated?: (result: { kind: CreatableReferenceKind; slug: string; category?: string }) => void;
}

export function CreateReferenceFromLabelDialog({
  open,
  onClose,
  item,
  noteId,
  onCreated,
}: CreateReferenceFromLabelDialogProps) {
  const navigate = useNavigate();
  const effortCtx = useOptionalEffortRegistry();
  const equipmentCtx = useOptionalEquipmentRegistry();
  const refreshEfforts = useCallback(
    async () => (effortCtx ? effortCtx.refresh() : hydrateAppEffortRegistry(getAppEffortRegistry())),
    [effortCtx],
  );
  const refreshEquipment = useCallback(
    async () => (equipmentCtx ? equipmentCtx.refresh() : hydrateAppEquipmentRegistry(getAppEquipmentRegistry())),
    [equipmentCtx],
  );

  const [kind, setKind] = useState<CreatableReferenceKind>('effort');
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagCategory, setTagCategory] = useState('general');
  const [availableCategories, setAvailableCategories] = useState<string[]>(() =>
    ['general', ...DEFAULT_TAG_TYPES.map((t) => t.name).filter((n) => n !== 'equipment' && n !== 'effort')],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    setKind(item.suggestedKind);
    const initialLabel =
      item.suggestedKind === 'tag'
        ? item.rawLabel.trim()
        : titleCaseFromLabel(item.rawLabel);
    setLabel(initialLabel);
    setSlug(item.candidateSlug || slugifyRefLabel(initialLabel));
    setSlugTouched(false);
    setTagCategory(item.suggestedCategory || 'general');
    setError(null);
    setSaving(false);

    let cancelled = false;
    storageService
      .getAllTagTypes()
      .then((rows) => {
        if (cancelled) return;
        const merged = new Set<string>(['general']);
        for (const t of DEFAULT_TAG_TYPES) {
          if (t.name !== 'effort' && t.name !== 'equipment') merged.add(t.name);
        }
        for (const r of rows) {
          if (r.name !== 'effort' && r.name !== 'equipment') merged.add(r.name);
        }
        setAvailableCategories([...merged]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  // Multi-word helper chips so e.g. "Macebell 360s" lets the user click "Macebell" to define Equipment first.
  const wordParts = useMemo(() => {
    if (!item) return [];
    const words = item.rawLabel.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [];
    return [item.rawLabel.trim(), words[0]!, words.slice(1).join(' ')].filter(
      (v, idx, arr) => v && arr.indexOf(v) === idx,
    );
  }, [item]);

  const handleLabelChange = (nextLabel: string) => {
    setLabel(nextLabel);
    if (!slugTouched) {
      setSlug(kind === 'tag' ? slugifyRefLabel(nextLabel) || nextLabel.trim() : slugifyRefLabel(nextLabel));
    }
  };

  const handleKindChange = (nextKind: CreatableReferenceKind) => {
    setKind(nextKind);
    setError(null);
    if (item && !slugTouched) {
      const nextLabel =
        nextKind === 'tag'
          ? slugifyRefLabel(label) || item.rawLabel.trim()
          : titleCaseFromLabel(label || item.rawLabel);
      setLabel(nextLabel);
      setSlug(slugifyRefLabel(nextLabel));
    }
  };

  const commit = useCallback(
    async (openAfterSave: boolean) => {
      if (!item) return;
      const cleanSlug = slug.trim().toLowerCase();
      const cleanLabel = label.trim() || cleanSlug;
      if (!cleanSlug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug)) {
        setError('Slug must be lowercase letters, numbers, and hyphens (e.g. "macebell-360").');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        if (kind === 'effort') {
          const rawContent = buildStarterEffortDocument(cleanSlug, cleanLabel, item.rawLabel);
          await commitReferenceNote({
            kind: 'effort',
            slug: cleanSlug,
            rawContent,
            title: cleanLabel,
            expectedSourceRevision: 0,
          });
          await refreshEfforts();
        } else if (kind === 'equipment') {
          const aliases =
            item.rawLabel.trim() && item.rawLabel.trim().toLowerCase() !== cleanLabel.toLowerCase()
              ? [item.rawLabel.trim()]
              : [];
          const baseDoc = equipmentToDocument({
            id: `equipment-user-${crypto.randomUUID()}`,
            slug: cleanSlug,
            label: cleanLabel,
            aliases,
            registrySource: 'user',
          });
          await commitReferenceNote({
            kind: 'equipment',
            slug: cleanSlug,
            rawContent: baseDoc,
            title: cleanLabel,
            expectedSourceRevision: 0,
          });
          await refreshEquipment();
        } else {
          const category = tagCategory.trim() || 'general';
          const tagDoc = buildTagNoteDocument({
            id: `tag-user-${crypto.randomUUID()}`,
            label: cleanSlug,
            type: category === 'general' ? undefined : category,
            contributions: [],
            createdAt: Date.now(),
          });
          await commitReferenceNote({
            kind: 'tag',
            slug: cleanSlug,
            category: category === 'general' ? 'tag' : category,
            rawContent: tagDoc,
            title: cleanSlug,
            expectedSourceRevision: 0,
          });
          await refreshTagIndex();
        }

        if (noteId) {
          await storageService.rebuildBlockIndexForNote(noteId).catch(() => {});
        }
        notifyReferenceCatalogChanged();
        onCreated?.({ kind, slug: cleanSlug, category: kind === 'tag' ? tagCategory : undefined });

        toast({
          title: `Created ${kind}`,
          description: `"${cleanLabel}" is now recognized across your notes.`,
        });
        onClose();

        if (openAfterSave) {
          const targetPath =
            kind === 'effort'
              ? effortPath(cleanSlug)
              : kind === 'equipment'
                ? equipmentPath(cleanSlug)
                : tagPath(tagCategory || 'general', cleanSlug);
          navigate(targetPath);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create definition.');
      } finally {
        setSaving(false);
      }
    },
    [
      item,
      slug,
      label,
      kind,
      tagCategory,
      noteId,
      refreshEfforts,
      refreshEquipment,
      onCreated,
      onClose,
      navigate,
    ],
  );

  if (!open || !item) return null;

  return (
    <EditorDialog
      open={open}
      onClose={onClose}
      title={`Define "${item.rawLabel}"`}
    >
      <div className="flex flex-col gap-4" data-testid="create-reference-dialog">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Create as
          </span>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1" role="radiogroup" aria-label="Reference kind">
            {(['effort', 'equipment', 'tag'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                data-testid={`create-reference-kind-${option}`}
                onClick={() => handleKindChange(option)}
                className={
                  kind === option
                    ? 'rounded-md bg-background px-2.5 py-1.5 text-xs font-semibold capitalize text-foreground shadow-sm'
                    : 'rounded-md px-2.5 py-1.5 text-xs font-medium capitalize text-muted-foreground hover:text-foreground'
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {wordParts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Phrase:</span>
            {wordParts.map((part) => (
              <button
                key={part}
                type="button"
                onClick={() => {
                  setSlugTouched(false);
                  handleLabelChange(kind === 'tag' ? slugifyRefLabel(part) : titleCaseFromLabel(part));
                }}
                className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-foreground hover:bg-muted"
              >
                {part}
              </button>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          <span>{kind === 'tag' ? 'Tag name' : 'Display label'}</span>
          <Input
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            data-testid="create-reference-label"
            placeholder={kind === 'tag' ? 'grip-endurance' : 'Macebell 360'}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          <span>Slug</span>
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            data-testid="create-reference-slug"
            className="font-mono text-xs"
            placeholder="macebell-360"
          />
        </label>

        {kind === 'tag' && (
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            <span>Category</span>
            <select
              value={tagCategory}
              onChange={(e) => setTagCategory(e.target.value)}
              data-testid="create-reference-tag-category"
              className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            data-testid="create-reference-submit-open"
            onClick={() => void commit(true)}
          >
            Create & open
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            data-testid="create-reference-submit"
            onClick={() => void commit(false)}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
}

/** App-level singleton host mounted once in AppContent. */
export function CreateReferenceFromLabelHost() {
  const [request, setRequest] = useState<CreateReferenceRequest | null>(null);

  useEffect(() => {
    hostListeners.add(setRequest);
    return () => {
      hostListeners.delete(setRequest);
    };
  }, []);

  return (
    <CreateReferenceFromLabelDialog
      open={request !== null}
      item={request?.item ?? null}
      noteId={request?.noteId}
      onClose={() => setRequest(null)}
    />
  );
}
