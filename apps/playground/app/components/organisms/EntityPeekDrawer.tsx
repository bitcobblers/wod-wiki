/**
 * EntityPeekDrawer — 340px right-edge non-destructive lookup & inline-define
 * drawer for Note & Editor surfaces (Slice 2 — 3-State Right Edge).
 *
 * Shares the 340px right-edge inspector slot mutually exclusively with
 * `WhiteboardInspectorDrawer` and Resting L3. Preserves editor cursor/scroll
 * while surfacing live metadata, scoped overrides, top 5 related notes, and
 * inline quick-creation for unrecognized terms without leaving the Note editor.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Dumbbell,
  FileText,
  Filter,
  Hash,
  HelpCircle,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  KNOWN_SECTION_WIDGETS,
  parseDocumentSections,
  type Note,
  type ScheduleItem,
  type ScopedPropertyOverride,
  type Session,
  type Tag,
} from '@bitcobblers/wod-wiki-core';
import {
  listScopedPropertyOverrides,
  notebookSlugFromId,
  toNotebookId,
  type JournalDayOverlay,
} from '@bitcobblers/wod-wiki-engine';
import {
  EFFORT_DISCIPLINES,
  effortToDocument,
  equipmentToDocument,
  slugifyRefLabel,
  tagRecordToDocument,
  type EffortDiscipline,
  type IEffort,
  type IEquipment,
} from '@bitcobblers/wod-wiki-lang';
import { WQL_TYPED_TAG_KEYS } from '@bitcobblers/wod-wiki-wql';
import { registerRenderedPeekState } from '@/agent/surfaceBridges';
import { useOptionalNavigate } from '@/hooks/useOptionalNavigate';
import { useStickyBoundaryOffset } from '@/panels/page-shells';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '@/services/effortRegistry';
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { notebookService } from '@/services/NotebookService';
import { storageService } from '@/services/storage';
import { DEFAULT_TAG_TYPES } from '@/services/storage/StorageService';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';
import { noteRefToPath, parseNoteId } from '@/lib/noteIdentity';
import { TEST_IDS } from '@/lib/testIds';
import { cn } from '@/lib/utils';
import type { BlockEffort } from '@/types/storage';
import type { Notebook } from '@/types/notebook';
import { useOptionalEffortRegistry } from '../../contexts/EffortRegistryContext';
import { useOptionalEquipmentRegistry } from '../../contexts/EquipmentRegistryContext';
import {
  dayPath,
  effortPath,
  equipmentPath,
  notebookPath,
  notePath,
  ROUTE_PATTERNS,
  tagPath,
} from '../../lib/routes';
import { notifyReferenceCatalogChanged } from '../../pages/shared/useLiveNoteFacets';
import { journalSchedule } from '../../services/journalSchedule';

/**
 * Shared Entity Peek target union — matches shell-core & detail-boards verbatim.
 */
export type EntityPeekTarget =
  | { kind: 'effort'; slug: string; label?: string }
  | { kind: 'equipment'; slug: string; label?: string }
  | { kind: 'tag'; tagType?: string; label: string }
  | { kind: 'unrecognized'; term: string }
  | { kind: 'note'; noteId: string; title?: string }
  | { kind: 'notebook'; slug: string; title?: string }
  | { kind: 'schedule'; entry: unknown }
  | { kind: 'day'; date: string };

export interface EntityPeekDrawerProps {
  target: EntityPeekTarget | null;
  onClose: () => void;
  layout?: 'docked-right' | 'overlay';
  onCreatedReference?: () => void;
}

type CreatableKind = 'effort' | 'equipment' | 'tag';

const MAX_PREVIEW_NOTES = 5;
const TYPED_WQL_KEYS = new Set<string>(WQL_TYPED_TAG_KEYS);

function formatWqlValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '""';
  if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildNotesFilterPath(key: string, value: string): string {
  const wql = `:note{${key}:${formatWqlValue(value)}}`;
  return `${ROUTE_PATTERNS.notes}?q=${encodeURIComponent(wql)}`;
}

function resolveNoteHref(noteId: string): string {
  const ref = parseNoteId(noteId);
  if (ref.kind === 'workout' && !ref.category) return notePath(noteId);
  return noteRefToPath(ref);
}

function titleCaseTerm(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '');
  if (!cleaned) return '';
  if (/[A-Z]/.test(cleaned)) return cleaned;
  return cleaned
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function extractNotePreview(rawContent: string): { wodBlock: string | null; excerpt: string | null } {
  if (!rawContent || !rawContent.trim()) {
    return { wodBlock: null, excerpt: null };
  }
  let wodBlock: string | null = null;
  let excerpt: string | null = null;

  try {
    const sections = parseDocumentSections(rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS });
    for (const section of sections) {
      if (!wodBlock && section.scriptBlock?.content?.trim()) {
        wodBlock = section.scriptBlock.content.trim().split('\n').slice(0, 8).join('\n');
      } else if (!wodBlock && section.type === 'code') {
        const firstLine = section.rawContent.split(/\r?\n/, 1)[0]?.trim() ?? '';
        if (/^`{3,}(?:time|log|wod|whiteboard)(?::[\w-]+)?\s*$/i.test(firstLine) && section.displayContent.trim()) {
          wodBlock = section.displayContent.trim().split('\n').slice(0, 8).join('\n');
        }
      }
      if (!excerpt && section.type === 'markdown') {
        const cleaned = section.displayContent
          .replace(/^#{1,6}\s+.*$/gm, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned) {
          excerpt = cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
        }
      }
    }
  } catch {
    // Fall back to plain strip below
  }

  if (!excerpt && !wodBlock) {
    const stripped = rawContent
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped) {
      excerpt = stripped.length > 220 ? `${stripped.slice(0, 217)}…` : stripped;
    }
  }

  return { wodBlock, excerpt };
}

interface RelatedNoteItem {
  id: string;
  title: string;
  href: string;
  createdAt?: number;
}

interface LoadedEffortData {
  kind: 'effort';
  slug: string;
  effort: IEffort | null;
  overrides: ScopedPropertyOverride[];
  notes: RelatedNoteItem[];
  totalNotes: number;
}

interface LoadedEquipmentData {
  kind: 'equipment';
  slug: string;
  equipment: IEquipment | null;
  notes: RelatedNoteItem[];
  totalNotes: number;
}

interface LoadedTagData {
  kind: 'tag';
  label: string;
  category: string;
  tag: Tag | null;
  notes: RelatedNoteItem[];
  totalNotes: number;
}

interface LoadedNoteData {
  kind: 'note';
  noteId: string;
  note: Note | null;
  tags: string[];
  wodBlock: string | null;
  excerpt: string | null;
  schedules: ScheduleItem[];
  sessions: Session[];
}

interface LoadedNotebookData {
  kind: 'notebook';
  slug: string;
  notebook: Notebook | null;
  notes: RelatedNoteItem[];
  totalNotes: number;
}

interface LoadedDayData {
  kind: 'day';
  date: string;
  overlay: JournalDayOverlay | null;
}

interface LoadedScheduleData {
  kind: 'schedule';
  title: string;
  date?: string;
  noteId?: string;
  status?: string;
  notes?: string;
}

interface LoadedUnrecognizedData {
  kind: 'unrecognized';
  term: string;
}

type LoadedPeekData =
  | LoadedEffortData
  | LoadedEquipmentData
  | LoadedTagData
  | LoadedNoteData
  | LoadedNotebookData
  | LoadedDayData
  | LoadedScheduleData
  | LoadedUnrecognizedData;

const SafeLink: React.FC<{
  to: string;
  className?: string;
  onClick?: () => void;
  testId?: string;
  title?: string;
  children: React.ReactNode;
}> = ({ to, className, onClick, testId, title, children }) => {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return (
      <Link
        to={to}
        onClick={onClick}
        data-testid={testId}
        title={title}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      href={to}
      onClick={(e) => {
        if (onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      data-testid={testId}
      title={title}
      className={className}
    >
      {children}
    </a>
  );
};

interface QuickCreateResult {
  kind: CreatableKind;
  slug: string;
  label: string;
  href: string;
}

const UnrecognizedQuickCreateForm: React.FC<{
  term: string;
  onCreated: (result: QuickCreateResult) => void;
}> = ({ term, onCreated }) => {
  const effortCtx = useOptionalEffortRegistry();
  const equipmentCtx = useOptionalEquipmentRegistry();
  const initialIsTag = term.trim().startsWith('#');
  const cleanInitial = term.trim().replace(/^#+/, '');

  const [kind, setKind] = useState<CreatableKind>(initialIsTag ? 'tag' : 'effort');
  const [label, setLabel] = useState<string>(() =>
    initialIsTag ? slugifyRefLabel(cleanInitial) || cleanInitial : titleCaseTerm(cleanInitial),
  );
  const [slug, setSlug] = useState<string>(() => slugifyRefLabel(cleanInitial));
  const [slugTouched, setSlugTouched] = useState(false);
  const [discipline, setDiscipline] = useState<string>('');
  const [metValue, setMetValue] = useState<string>('5.0');
  const [tagCategory, setTagCategory] = useState<string>('general');
  const [categories, setCategories] = useState<string[]>(() => [
    'general',
    ...DEFAULT_TAG_TYPES.map((t) => t.name).filter((n) => n !== 'effort' && n !== 'equipment'),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isTag = term.trim().startsWith('#');
    const clean = term.trim().replace(/^#+/, '');
    const nextKind: CreatableKind = isTag ? 'tag' : 'effort';
    setKind(nextKind);
    setLabel(isTag ? slugifyRefLabel(clean) || clean : titleCaseTerm(clean));
    setSlug(slugifyRefLabel(clean));
    setSlugTouched(false);
    setDiscipline('');
    setMetValue('5.0');
    setTagCategory('general');
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
        setCategories([...merged]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [term]);

  const handleKindChange = (nextKind: CreatableKind) => {
    setKind(nextKind);
    setError(null);
    if (!slugTouched) {
      const nextLabel =
        nextKind === 'tag'
          ? slugifyRefLabel(label || cleanInitial) || cleanInitial
          : titleCaseTerm(label || cleanInitial);
      setLabel(nextLabel);
      setSlug(slugifyRefLabel(nextLabel));
    }
  };

  const handleLabelChange = (nextLabel: string) => {
    setLabel(nextLabel);
    if (!slugTouched) {
      setSlug(slugifyRefLabel(nextLabel));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanSlug = slug.trim().toLowerCase();
    const cleanLabel = label.trim() || cleanSlug;
    if (!cleanSlug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug)) {
      setError('Slug must use lowercase letters, numbers, and hyphens (e.g. "ring-dip").');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const rawAlias = term.trim().replace(/^#+/, '');
      const aliases =
        rawAlias &&
        rawAlias.toLowerCase() !== cleanLabel.toLowerCase() &&
        rawAlias.toLowerCase() !== cleanSlug
          ? [rawAlias]
          : [];

      if (kind === 'effort') {
        const parsedMet = Number.parseFloat(metValue);
        const met = Number.isFinite(parsedMet) && parsedMet > 0 ? parsedMet : 5.0;
        const now = new Date().toISOString();
        const rawContent = effortToDocument({
          id: `effort-user-${uuidv7()}`,
          slug: cleanSlug,
          label: cleanLabel,
          aliases,
          baseAttributes: {
            met,
            ...(discipline ? { discipline: discipline as EffortDiscipline } : {}),
          },
          registrySource: 'user',
          createdAt: now,
          updatedAt: now,
        });
        await commitReferenceNote({
          kind: 'effort',
          slug: cleanSlug,
          rawContent,
          title: cleanLabel,
          expectedSourceRevision: 0,
        });
        await (effortCtx ? effortCtx.refresh() : hydrateAppEffortRegistry(getAppEffortRegistry()));
        notifyReferenceCatalogChanged();
        onCreated({
          kind: 'effort',
          slug: cleanSlug,
          label: cleanLabel,
          href: effortPath(cleanSlug),
        });
      } else if (kind === 'equipment') {
        const rawContent = equipmentToDocument({
          id: `equipment-user-${uuidv7()}`,
          slug: cleanSlug,
          label: cleanLabel,
          aliases,
          registrySource: 'user',
        });
        await commitReferenceNote({
          kind: 'equipment',
          slug: cleanSlug,
          rawContent,
          title: cleanLabel,
          expectedSourceRevision: 0,
        });
        await (equipmentCtx
          ? equipmentCtx.refresh()
          : hydrateAppEquipmentRegistry(getAppEquipmentRegistry()));
        notifyReferenceCatalogChanged();
        onCreated({
          kind: 'equipment',
          slug: cleanSlug,
          label: cleanLabel,
          href: equipmentPath(cleanSlug),
        });
      } else {
        const category = tagCategory.trim() || 'general';
        const tagDoc = tagRecordToDocument({
          id: `tag-user-${uuidv7()}`,
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
        notifyReferenceCatalogChanged();
        onCreated({
          kind: 'tag',
          slug: cleanSlug,
          label: `#${cleanSlug}`,
          href: tagPath(category, cleanSlug),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to catalog.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      data-testid={TEST_IDS.ENTITY_PEEK_CREATE_FORM}
      className="space-y-3"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Unmapped phrase in your note. Save it into your catalog without leaving the editor.
      </p>

      <div className="space-y-1.5">
        <span className="block text-xs font-semibold text-foreground">Save into catalog</span>
        <div
          role="group"
          aria-label="Catalog kind"
          data-testid={TEST_IDS.ENTITY_PEEK_CREATE_KIND}
          className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/50 p-1"
        >
          {(['effort', 'equipment', 'tag'] as const).map((option) => {
            const active = kind === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => handleKindChange(option)}
                className={cn(
                  'rounded-md px-2 py-1.5 max-lg:min-h-11 text-xs font-semibold capitalize transition-colors cursor-pointer',
                  active
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="entity-peek-create-label" className="block text-xs font-medium text-foreground">
          {kind === 'tag' ? 'Tag name' : 'Display label'}
        </label>
        <input
          id="entity-peek-create-label"
          type="text"
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          disabled={saving}
          data-testid={TEST_IDS.ENTITY_PEEK_CREATE_LABEL}
          placeholder={kind === 'tag' ? 'ring-work' : 'Ring Dip'}
          className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="entity-peek-create-slug" className="block text-xs font-medium text-foreground">
          Canonical slug
        </label>
        <input
          id="entity-peek-create-slug"
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          disabled={saving}
          data-testid={TEST_IDS.ENTITY_PEEK_CREATE_SLUG}
          placeholder="ring-dip"
          className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      </div>

      {kind === 'effort' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="entity-peek-create-discipline" className="block text-xs font-medium text-foreground">
              Discipline
            </label>
            <select
              id="entity-peek-create-discipline"
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              disabled={saving}
              className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="">Default</option>
              {EFFORT_DISCIPLINES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="entity-peek-create-met" className="block text-xs font-medium text-foreground">
              MET
            </label>
            <input
              id="entity-peek-create-met"
              type="number"
              step="0.5"
              min="1"
              max="25"
              value={metValue}
              onChange={(e) => setMetValue(e.target.value)}
              disabled={saving}
              className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs tabular-nums text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
        </div>
      )}

      {kind === 'tag' && (
        <div className="space-y-1">
          <label htmlFor="entity-peek-create-category" className="block text-xs font-medium text-foreground">
            Category
          </label>
          <select
            id="entity-peek-create-category"
            value={tagCategory}
            onChange={(e) => setTagCategory(e.target.value)}
            disabled={saving}
            data-testid={TEST_IDS.ENTITY_PEEK_CREATE_CATEGORY}
            className="h-9 max-lg:min-h-11 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        data-testid={TEST_IDS.ENTITY_PEEK_CREATE_SUBMIT}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 max-lg:min-h-11 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
      >
        <Sparkles className="size-3.5" aria-hidden="true" />
        <span>{saving ? 'Saving to Catalog…' : 'Save to Catalog'}</span>
      </button>
    </form>
  );
};

export const EntityPeekDrawer: React.FC<EntityPeekDrawerProps> = ({
  target,
  onClose,
  layout = 'docked-right',
  onCreatedReference,
}) => {
  const stickyTop = useStickyBoundaryOffset(65);
  const navigate = useOptionalNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LoadedPeekData | null>(null);
  const [createdResult, setCreatedResult] = useState<QuickCreateResult | null>(null);

  // Publish live rendered peek state to the zero-dependency WebMCP bridge seam.
  useEffect(() => {
    return registerRenderedPeekState(target, onClose);
  }, [target, onClose]);

  // Dismiss on Escape from anywhere in the document while open.
  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [target, onClose]);

  const targetKey = useMemo(() => {
    if (!target) return '';
    switch (target.kind) {
      case 'effort':
        return `effort:${target.slug}:${target.label ?? ''}`;
      case 'equipment':
        return `equipment:${target.slug}:${target.label ?? ''}`;
      case 'tag':
        return `tag:${target.tagType ?? ''}:${target.label}`;
      case 'unrecognized':
        return `unrecognized:${target.term}`;
      case 'note':
        return `note:${target.noteId}:${target.title ?? ''}`;
      case 'notebook':
        return `notebook:${target.slug}:${target.title ?? ''}`;
      case 'day':
        return `day:${target.date}`;
      case 'schedule':
        return `schedule:${JSON.stringify(target.entry ?? null).slice(0, 120)}`;
    }
  }, [target]);

  useEffect(() => {
    setCreatedResult(null);
    if (!target) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async (): Promise<LoadedPeekData> => {
      switch (target.kind) {
        case 'effort': {
          const registry = getAppEffortRegistry();
          let effort: IEffort | null = registry.isInitialized()
            ? (registry.resolve(target.slug) ?? registry.resolveByAlias(target.slug))
            : null;
          if (!effort) {
            effort = (await storageService.getEffort(target.slug).catch(() => undefined)) ?? null;
          }
          if (!effort) {
            const allEfforts = await storageService.getAllEfforts().catch(() => [] as IEffort[]);
            const lower = target.slug.toLowerCase();
            effort =
              allEfforts.find(
                (e) =>
                  e.slug.toLowerCase() === lower ||
                  e.label.toLowerCase() === lower ||
                  e.aliases.some((a) => a.toLowerCase() === lower),
              ) ?? null;
          }
          const canonicalSlug = effort?.slug ?? target.slug;
          const [usageRows, overrides] = await Promise.all([
            (storageService
              .getAllFromIndex('block_efforts', 'by-effort', canonicalSlug)
              .catch(() => []) as Promise<BlockEffort[]>),
            listScopedPropertyOverrides(storageService.storage, {
              kind: 'effort',
              slug: canonicalSlug,
            }).catch(() => [] as ScopedPropertyOverride[]),
          ]);
          const excludeIds = new Set<string>(
            [effort?.ownerNoteId, `effort/${canonicalSlug}`].filter((x): x is string => Boolean(x)),
          );
          const uniqueIds = [...new Set(usageRows.map((r) => r.noteId).filter((id) => !excludeIds.has(id)))];
          const fetchedNotes = uniqueIds.length > 0
            ? await storageService.getNotesByIds(uniqueIds).catch(() => [] as Note[])
            : [];
          const noteById = new Map(fetchedNotes.map((n) => [n.id, n]));
          const allItems: RelatedNoteItem[] = uniqueIds
            .map((id) => {
              const n = noteById.get(id);
              return {
                id,
                title: n?.title || id,
                href: resolveNoteHref(id),
                createdAt: n?.createdAt ?? 0,
              };
            })
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

          return {
            kind: 'effort',
            slug: canonicalSlug,
            effort,
            overrides,
            notes: allItems.slice(0, MAX_PREVIEW_NOTES),
            totalNotes: allItems.length,
          };
        }

        case 'equipment': {
          const registry = getAppEquipmentRegistry();
          let equipment: IEquipment | null = registry.isInitialized()
            ? (registry.resolve(target.slug) ?? registry.resolveByAlias(target.slug))
            : null;
          if (!equipment) {
            equipment = (await storageService.getEquipment(target.slug).catch(() => undefined)) ?? null;
          }
          if (!equipment) {
            const allEquipment = await storageService.getAllEquipment().catch(() => [] as IEquipment[]);
            const lower = target.slug.toLowerCase();
            equipment =
              allEquipment.find(
                (eq) =>
                  eq.slug.toLowerCase() === lower ||
                  eq.label.toLowerCase() === lower ||
                  eq.aliases.some((a) => a.toLowerCase() === lower),
              ) ?? null;
          }
          const canonicalSlug = equipment?.slug ?? target.slug;
          const usage = await storageService.getEquipmentUsage(canonicalSlug).catch(() => []);
          const excludeIds = new Set<string>(
            [equipment?.ownerNoteId, `equipment/${canonicalSlug}`].filter((x): x is string => Boolean(x)),
          );
          const filtered = usage.filter((row) => !excludeIds.has(row.noteId));
          const allItems: RelatedNoteItem[] = filtered.map((row) => ({
            id: row.noteId,
            title: row.title || row.noteId,
            href: resolveNoteHref(row.noteId),
          }));

          return {
            kind: 'equipment',
            slug: canonicalSlug,
            equipment,
            notes: allItems.slice(0, MAX_PREVIEW_NOTES),
            totalNotes: allItems.length,
          };
        }

        case 'tag': {
          const cleanLabel = target.label.trim().replace(/^#+/, '');
          const lower = cleanLabel.toLowerCase();
          let tag = (await storageService.getTagByLabel(cleanLabel).catch(() => undefined)) ?? null;
          if (!tag) {
            const allTags = await storageService.getAllTags().catch(() => [] as Tag[]);
            tag = allTags.find((t) => t.label.trim().toLowerCase() === lower) ?? null;
          }
          const resolvedLabel = tag?.label ?? cleanLabel;
          const category = tag?.type || target.tagType || 'general';

          const [linkedNotes, allNotes] = await Promise.all([
            storageService.getNotesForTag(resolvedLabel).catch(() => [] as Note[]),
            storageService.getAllNotes().catch(() => [] as Note[]),
          ]);

          const byId = new Map<string, Note>();
          for (const n of linkedNotes) byId.set(n.id, n);
          for (const n of allNotes) {
            if (byId.has(n.id)) continue;
            if (n.tags?.some((t) => t.trim().toLowerCase() === lower)) {
              byId.set(n.id, n);
            }
          }

          const allItems: RelatedNoteItem[] = [...byId.values()]
            .filter((n) => !n.id.startsWith('t/'))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .map((n) => ({
              id: n.id,
              title: n.title || n.id,
              href: resolveNoteHref(n.id),
              createdAt: n.createdAt,
            }));

          return {
            kind: 'tag',
            label: resolvedLabel,
            category,
            tag,
            notes: allItems.slice(0, MAX_PREVIEW_NOTES),
            totalNotes: allItems.length,
          };
        }

        case 'unrecognized':
          return {
            kind: 'unrecognized',
            term: target.term,
          };

        case 'note': {
          const [note, noteTags, schedules, sessions] = await Promise.all([
            storageService.getNote(target.noteId).catch(() => undefined),
            storageService.getTagsForNote(target.noteId).catch(() => [] as Tag[]),
            journalSchedule.listForNote(target.noteId).catch(() => [] as ScheduleItem[]),
            storageService.getSessionsForNote(target.noteId).catch(() => [] as Session[]),
          ]);
          const mergedTags = new Set<string>();
          for (const t of noteTags) {
            if (t.label && !t.label.startsWith('notebook:') && !t.label.startsWith('notebook/')) {
              mergedTags.add(t.label);
            }
          }
          for (const t of note?.tags ?? []) {
            if (t && !t.startsWith('notebook:') && !t.startsWith('notebook/')) {
              mergedTags.add(t);
            }
          }
          const preview = extractNotePreview(note?.rawContent ?? '');
          return {
            kind: 'note',
            noteId: target.noteId,
            note: note ?? null,
            tags: [...mergedTags],
            wodBlock: preview.wodBlock,
            excerpt: preview.excerpt,
            schedules,
            sessions,
          };
        }

        case 'notebook': {
          const [allNotebooks, memberNotes] = await Promise.all([
            notebookService.getAllNotebooks().catch(() => [] as Notebook[]),
            notebookService.listNotes(target.slug).catch(() => [] as Note[]),
          ]);
          const targetNotebookId = toNotebookId(target.slug);
          const notebook =
            allNotebooks.find(
              (nb) =>
                nb.slug.toLowerCase() === target.slug.toLowerCase() ||
                nb.notebookId === targetNotebookId,
            ) ?? null;
          const sorted = [...memberNotes].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
          const allItems: RelatedNoteItem[] = sorted.map((n) => ({
            id: n.id,
            title: n.title || n.id,
            href: resolveNoteHref(n.id),
            createdAt: n.createdAt,
          }));
          return {
            kind: 'notebook',
            slug: notebook?.slug ?? target.slug,
            notebook,
            notes: allItems.slice(0, MAX_PREVIEW_NOTES),
            totalNotes: allItems.length,
          };
        }

        case 'day': {
          const overlay = await journalSchedule.getDayOverlay(target.date).catch(() => null);
          return {
            kind: 'day',
            date: target.date,
            overlay,
          };
        }

        case 'schedule': {
          const record =
            typeof target.entry === 'object' && target.entry !== null
              ? (target.entry as Record<string, unknown>)
              : {};
          return {
            kind: 'schedule',
            title: typeof record.title === 'string' && record.title.trim() ? record.title : 'Scheduled Workout',
            date: typeof record.date === 'string' ? record.date : undefined,
            noteId:
              typeof record.noteId === 'string'
                ? record.noteId
                : typeof record.id === 'string'
                  ? record.id
                  : undefined,
            status:
              typeof record.scheduleStatus === 'string'
                ? record.scheduleStatus
                : typeof record.status === 'string'
                  ? record.status
                  : undefined,
            notes:
              typeof record.scheduleNotes === 'string'
                ? record.scheduleNotes
                : typeof record.notes === 'string'
                  ? record.notes
                  : undefined,
          };
        }
      }
    };

    void load()
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures full target identity
  }, [targetKey]);

  const handleOpenHref = useCallback(
    (href: string) => {
      onClose();
      if (navigate) {
        void navigate(href);
      }
    },
    [navigate, onClose],
  );

  if (!target) return null;

  // Derive header + footer metadata immediately so the drawer renders cleanly even while async reads settle.
  let kindBadge = 'Entity Peek';
  let headingTitle = '';
  let slugSubtitle: string | null = null;
  let fullPageHref: string | null = null;
  let filterNotesHref: string | null = null;
  let KindIcon: React.ComponentType<{ className?: string }> = FileText;

  switch (target.kind) {
    case 'effort': {
      const eff = data?.kind === 'effort' ? data.effort : null;
      const effSlug = data?.kind === 'effort' ? data.slug : target.slug;
      const discipline = eff?.baseAttributes?.discipline;
      kindBadge = discipline ? `Effort · ${discipline}` : 'Effort';
      headingTitle = eff?.label || target.label || effSlug;
      slugSubtitle = effSlug;
      fullPageHref = effortPath(effSlug);
      filterNotesHref = buildNotesFilterPath('effort', effSlug);
      KindIcon = Dumbbell;
      break;
    }
    case 'equipment': {
      const eq = data?.kind === 'equipment' ? data.equipment : null;
      const eqSlug = data?.kind === 'equipment' ? data.slug : target.slug;
      kindBadge = 'Equipment';
      headingTitle = eq?.label || target.label || eqSlug;
      slugSubtitle = eqSlug;
      fullPageHref = equipmentPath(eqSlug);
      filterNotesHref = buildNotesFilterPath('equipment', eqSlug);
      KindIcon = Wrench;
      break;
    }
    case 'tag': {
      const tagLabel = (data?.kind === 'tag' ? data.label : target.label).replace(/^#+/, '');
      const category = data?.kind === 'tag' ? data.category : (target.tagType || 'general');
      const lowerCat = category.toLowerCase();
      const filterKey =
        TYPED_WQL_KEYS.has(lowerCat) && lowerCat !== 'effort' && lowerCat !== 'equipment'
          ? lowerCat
          : 'tags';
      kindBadge = `Tag · ${category}`;
      headingTitle = `#${tagLabel}`;
      fullPageHref = tagPath(category, tagLabel);
      filterNotesHref = buildNotesFilterPath(filterKey, tagLabel);
      KindIcon = Hash;
      break;
    }
    case 'unrecognized': {
      const cleanTerm = target.term.trim().replace(/^#+/, '');
      kindBadge = 'Unrecognized Term · Quick Define';
      headingTitle = target.term;
      fullPageHref = createdResult?.href ?? null;
      filterNotesHref = buildNotesFilterPath('text', cleanTerm);
      KindIcon = HelpCircle;
      break;
    }
    case 'note': {
      const note = data?.kind === 'note' ? data.note : null;
      kindBadge = note?.type === 'journal' ? 'Note · Journal' : 'Note';
      headingTitle = note?.title || target.title || target.noteId;
      fullPageHref = resolveNoteHref(target.noteId);
      filterNotesHref = buildNotesFilterPath('text', headingTitle);
      KindIcon = FileText;
      break;
    }
    case 'notebook': {
      const nb = data?.kind === 'notebook' ? data.notebook : null;
      const nbSlug = data?.kind === 'notebook' ? data.slug : target.slug;
      kindBadge = 'Notebook';
      headingTitle = nb?.name || target.title || nbSlug;
      slugSubtitle = nbSlug;
      fullPageHref = notebookPath(nbSlug);
      filterNotesHref = buildNotesFilterPath('notebook', nbSlug);
      KindIcon = BookOpen;
      break;
    }
    case 'day': {
      kindBadge = 'Journal Day';
      headingTitle = target.date;
      fullPageHref = dayPath(target.date);
      filterNotesHref = buildNotesFilterPath('date', target.date);
      KindIcon = Calendar;
      break;
    }
    case 'schedule': {
      const sched = data?.kind === 'schedule' ? data : null;
      kindBadge = 'Schedule Entry';
      headingTitle = sched?.title ?? 'Scheduled Workout';
      fullPageHref = sched?.noteId
        ? resolveNoteHref(sched.noteId)
        : sched?.date
          ? dayPath(sched.date)
          : ROUTE_PATTERNS.journal;
      filterNotesHref = buildNotesFilterPath('text', headingTitle);
      KindIcon = Calendar;
      break;
    }
  }

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close entity peek drawer"
        data-testid={TEST_IDS.ENTITY_PEEK_BACKDROP}
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[29] bg-black/25 cursor-default',
          layout === 'docked-right' && 'xl:hidden',
        )}
      />
      <aside
        role="complementary"
        aria-label="Entity Peek Drawer"
        data-testid={TEST_IDS.ENTITY_PEEK_DRAWER}
        style={
          layout === 'docked-right'
            ? ({ '--peek-sticky-top': `${stickyTop}px` } as React.CSSProperties)
            : undefined
        }
        className={cn(
          'fixed right-0 bottom-0 z-30 flex w-[340px] max-w-[92vw] flex-col overflow-hidden border-l border-border bg-card text-card-foreground',
          layout === 'docked-right'
            ? 'max-xl:top-[var(--peek-sticky-top)] max-xl:shadow-xl xl:top-0 xl:shadow-none'
            : 'top-0 shadow-2xl',
        )}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <KindIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{kindBadge}</span>
            </div>
            <h2 className="mt-0.5 break-words text-[15px] font-bold leading-snug text-foreground">
              {headingTitle}
            </h2>
            {slugSubtitle && (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {slugSubtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close entity peek drawer"
            title="Close (Esc)"
            data-testid={TEST_IDS.ENTITY_PEEK_CLOSE}
            className="inline-flex h-8 w-8 max-lg:min-h-11 max-lg:min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
          {loading && target.kind !== 'unrecognized' && (
            <div role="status" className="text-xs text-muted-foreground">
              Loading preview…
            </div>
          )}

          {/* Effort Preview */}
          {data?.kind === 'effort' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Discipline</span>
                  <strong className="text-sm font-semibold capitalize text-foreground">
                    {data.effort?.baseAttributes?.discipline ?? '—'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">MET</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.effort?.baseAttributes?.met !== undefined
                      ? data.effort.baseAttributes.met.toFixed(1)
                      : '—'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Intensity</span>
                  <strong className="text-sm font-semibold capitalize text-foreground">
                    {data.effort?.baseAttributes?.intensityTier ?? '—'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Used in</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.totalNotes} {data.totalNotes === 1 ? 'note' : 'notes'}
                  </strong>
                </div>
              </div>

              {data.effort?.aliases && data.effort.aliases.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Aliases
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.effort.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.overrides.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Scoped Overrides ({data.overrides.length})
                  </h3>
                  <div className="flex flex-col gap-1">
                    {data.overrides.map((ov) => {
                      const nbSlug = notebookSlugFromId(ov.notebookId);
                      const overrideHref = `${effortPath(data.slug)}?notebook=${encodeURIComponent(nbSlug)}`;
                      return (
                        <SafeLink
                          key={ov.id}
                          to={overrideHref}
                          onClick={onClose}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 max-lg:min-h-11 text-xs text-foreground hover:bg-muted"
                        >
                          <span className="truncate font-medium">
                            {nbSlug} · {ov.label}
                          </span>
                          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </SafeLink>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.effort?.body?.trim() && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {data.effort.body.trim().slice(0, 220)}
                  {data.effort.body.trim().length > 220 ? '…' : ''}
                </p>
              )}

              <RelatedNotesSection
                heading={`Used in Notes (${data.totalNotes})`}
                notes={data.notes}
                totalCount={data.totalNotes}
                filterHref={buildNotesFilterPath('effort', data.slug)}
                onNavigate={onClose}
              />
            </>
          )}

          {/* Equipment Preview */}
          {data?.kind === 'equipment' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Source</span>
                  <strong className="text-sm font-semibold capitalize text-foreground">
                    {data.equipment?.registrySource ?? 'catalog'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Related Notes</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.totalNotes} {data.totalNotes === 1 ? 'note' : 'notes'}
                  </strong>
                </div>
              </div>

              {data.equipment?.aliases && data.equipment.aliases.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Aliases
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.equipment.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.equipment?.body?.trim() && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {data.equipment.body.trim().slice(0, 220)}
                  {data.equipment.body.trim().length > 220 ? '…' : ''}
                </p>
              )}

              <RelatedNotesSection
                heading={`Related Notes (${data.totalNotes})`}
                notes={data.notes}
                totalCount={data.totalNotes}
                filterHref={buildNotesFilterPath('equipment', data.slug)}
                onNavigate={onClose}
              />
            </>
          )}

          {/* Tag Preview */}
          {data?.kind === 'tag' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Category</span>
                  <strong className="text-sm font-semibold capitalize text-foreground">
                    {data.category}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Tagged Notes</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.totalNotes} {data.totalNotes === 1 ? 'note' : 'notes'}
                  </strong>
                </div>
              </div>

              <RelatedNotesSection
                heading={`Top Notes (${data.totalNotes})`}
                notes={data.notes}
                totalCount={data.totalNotes}
                filterHref={filterNotesHref ?? ROUTE_PATTERNS.notes}
                onNavigate={onClose}
              />
            </>
          )}

          {/* Unrecognized Term Inline Quick-Create */}
          {target.kind === 'unrecognized' && (
            createdResult ? (
              <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>Saved to {createdResult.kind} catalog</span>
                </div>
                <p className="text-xs text-foreground">
                  <strong>{createdResult.label}</strong> (<code>{createdResult.slug}</code>) is now
                  recognized across your notes without leaving your current draft.
                </p>
              </div>
            ) : (
              <UnrecognizedQuickCreateForm
                term={target.term}
                onCreated={(result) => {
                  setCreatedResult(result);
                  onCreatedReference?.();
                }}
              />
            )
          )}

          {/* Note Preview */}
          {data?.kind === 'note' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Scheduled</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.schedules.length} {data.schedules.length === 1 ? 'day' : 'days'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Sessions</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.sessions.length} logged
                  </strong>
                </div>
              </div>

              {data.tags.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((tagLabel) => (
                      <span
                        key={tagLabel}
                        className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary"
                      >
                        #{tagLabel}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.wodBlock && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workout Preview
                  </h3>
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed text-foreground">
                    {data.wodBlock}
                  </pre>
                </div>
              )}

              {data.excerpt && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Excerpt
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{data.excerpt}</p>
                </div>
              )}

              {!data.note && !loading && (
                <p className="text-xs text-muted-foreground">
                  This note was not found in local storage.
                </p>
              )}
            </>
          )}

          {/* Notebook Preview */}
          {data?.kind === 'notebook' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Notes</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.totalNotes} {data.totalNotes === 1 ? 'note' : 'notes'}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Origin</span>
                  <strong className="text-sm font-semibold capitalize text-foreground">
                    {data.notebook?.origin ?? 'notebook'}
                  </strong>
                </div>
              </div>

              {data.notebook?.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {data.notebook.description}
                </p>
              )}

              <RelatedNotesSection
                heading={`Recent Notes (${data.totalNotes})`}
                notes={data.notes}
                totalCount={data.totalNotes}
                filterHref={buildNotesFilterPath('notebook', data.slug)}
                onNavigate={onClose}
              />
            </>
          )}

          {/* Day Preview */}
          {data?.kind === 'day' && (
            <>
              <div className="grid grid-cols-2 gap-2.5 border-b border-border pb-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Planned</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.overlay?.planned.length ?? 0}
                  </strong>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Logged</span>
                  <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {data.overlay?.allSessions.length ??
                      ((data.overlay?.adhocSessions.length ?? 0) +
                        (data.overlay?.planned.reduce((sum, entry) => sum + entry.pairedSessions.length, 0) ?? 0))}
                  </strong>
                </div>
              </div>
              {data.overlay && data.overlay.planned.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Scheduled Items
                  </h3>
                  <div className="flex flex-col gap-1">
                    {data.overlay.planned.slice(0, MAX_PREVIEW_NOTES).map((entry) => (
                      <SafeLink
                        key={entry.item.id}
                        to={resolveNoteHref(entry.item.noteId)}
                        onClick={onClose}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 max-lg:min-h-11 text-xs text-foreground hover:bg-muted"
                      >
                        <span className="truncate">{entry.note?.title || entry.item.noteId}</span>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">
                          {entry.item.status}
                        </span>
                      </SafeLink>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Schedule Entry Preview */}
          {data?.kind === 'schedule' && (
            <div className="space-y-2.5">
              {data.date && (
                <div className="text-xs text-muted-foreground">
                  Scheduled for <strong className="text-foreground">{data.date}</strong>
                  {data.status ? ` · ${data.status}` : ''}
                </div>
              )}
              {data.notes && (
                <p className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs text-foreground whitespace-pre-wrap">
                  {data.notes}
                </p>
              )}
            </div>
          )}

          <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
            Editor scroll &amp; cursor stay active · Press <strong className="text-foreground">Esc</strong> to close
          </p>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-3.5 py-2.5">
          {fullPageHref && (
            <SafeLink
              to={fullPageHref}
              onClick={() => handleOpenHref(fullPageHref!)}
              testId={TEST_IDS.ENTITY_PEEK_OPEN_FULL}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 max-lg:min-h-11 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap"
            >
              <span>Open full page →</span>
            </SafeLink>
          )}
          {filterNotesHref && (
            <SafeLink
              to={filterNotesHref}
              onClick={() => handleOpenHref(filterNotesHref!)}
              testId={TEST_IDS.ENTITY_PEEK_FILTER_NOTES}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 max-lg:min-h-11 text-xs font-medium text-foreground transition-colors hover:bg-muted whitespace-nowrap"
            >
              <Filter className="size-3" aria-hidden="true" />
              <span>Filter in Notes →</span>
            </SafeLink>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2.5 py-1.5 max-lg:min-h-11 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap"
          >
            Close (Esc)
          </button>
        </footer>
      </aside>
    </>
  );
};

const RelatedNotesSection: React.FC<{
  heading: string;
  notes: readonly RelatedNoteItem[];
  totalCount: number;
  filterHref: string;
  onNavigate: () => void;
}> = ({ heading, notes, totalCount, filterHref, onNavigate }) => {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No linked notes yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {notes.map((item) => (
            <SafeLink
              key={item.id}
              to={item.href}
              onClick={onNavigate}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/25 px-2.5 py-1.5 max-lg:min-h-11 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <span className="truncate">{item.title}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </SafeLink>
          ))}
        </div>
      )}
      {totalCount > MAX_PREVIEW_NOTES && (
        <SafeLink
          to={filterHref}
          onClick={onNavigate}
          testId={TEST_IDS.ENTITY_PEEK_VIEW_ALL_NOTES}
          className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-primary hover:underline max-lg:min-h-11"
        >
          <span>View all {totalCount} in Notes →</span>
        </SafeLink>
      )}
    </div>
  );
};
