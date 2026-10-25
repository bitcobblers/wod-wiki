import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { frontmatterSuggestions, frontmatterReferenceIndex, referenceIndexReload, type FrontmatterReferenceProvider } from '@bitcobblers/wod-wiki-ui/extensions';
import { createReferenceIndex, type IEffort, type IEquipment, type ReferenceIndex, type ReferenceResolutionDefaults } from '@bitcobblers/wod-wiki-lang';
import { parseFrontmatter } from '@bitcobblers/wod-wiki-wql';
import { storageService } from '@/services/storage';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { getAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { SEED_BROADCAST_CHANNEL } from '@/services/feed/feedSync';
import { v7 as uuidv7 } from 'uuid';
import { appWarn } from '@/lib/log';
import { IndexedDBNotePersistence, type INotePersistence } from '@/services/persistence';
import { entryOpenHref } from '../../../app/lib/entryActions';
import type { Entry } from '../../../app/lib/entryActions';
import type { PaletteDataSource, PaletteItem } from '@/components/organisms/command-palette/palette-types';

export function createFrontmatterSuggestions(): Extension {
  return frontmatterSuggestions.of(async () => {
    const [types, tags, catalog] = await Promise.all([
      storageService.getAllTagTypes(),
      storageService.getAllTags(),
      loadReferenceCatalog(),
    ]);
    return {
      types: types.map((type) => type.name),
      tags,
      efforts: catalog.efforts.map((effort) => ({ slug: effort.slug, label: effort.label, aliases: effort.aliases ?? [] })),
      equipment: catalog.equipment.map((item) => ({ slug: item.slug, label: item.label, aliases: item.aliases ?? [] })),
    };
  });
}

// ── Shared reference resolver for the editor surface ─────────────────
// Sync over the hydrated app registries (refreshed by existing flows);
// rebuilt only when catalog content changes.

interface CatalogSnapshot {
  efforts: IEffort[];
  equipment: IEquipment[];
}

let providerCache: {
  index: ReferenceIndex;
  provider: FrontmatterReferenceProvider;
  signature: string;
} | null = null;

/** Route href for an existing effort/equipment page via the app's entry actions. */
function referenceOpenHref(kind: 'effort' | 'equipment', slug: string, label: string): string {
  const entry: Entry = kind === 'effort'
    ? { id: slug, kind: 'effort', sourceCatalog: 'efforts', sourceItem: slug, title: label, date: null, effort: { slug, label } }
    : { id: slug, kind: 'equipment', sourceCatalog: 'equipment', sourceItem: slug, title: label, date: null };
  return entryOpenHref(entry);
}

/** Route href for a tag — the catalogue page, opened on that tag. */
function tagOpenHref(slug: string): string {
  return `/tags?tag=${encodeURIComponent(slug)}`;
}

function buildProvider(index: ReferenceIndex): FrontmatterReferenceProvider {
  return {
    resolve: (label, defaults) => index.resolve(label, defaults),
    resolveEffort: (slugOrAlias) => index.resolveEffort(slugOrAlias),
    resolveEquipment: (slugOrAlias) => index.resolveEquipment(slugOrAlias),
    openHref: (kind, slug) => (kind === 'tag' ? tagOpenHref(slug) : referenceOpenHref(kind, slug, slug)),
    createHref: (kind) => (kind === 'effort'
      ? '/e/new?mode=create'
      : kind === 'equipment'
        ? '/equipment/new?mode=create'
        : '/tags'),
  };
}

function catalogSignature(snapshot: CatalogSnapshot): string {
  return JSON.stringify([
    snapshot.efforts.map((effort) => [effort.slug, effort.label, effort.aliases ?? [], effort.equipment ?? []]),
    snapshot.equipment.map((item) => [item.slug, item.label, item.aliases ?? []]),
  ]);
}

/**
 * Synchronous accessor for the shared resolver provider. Reads the hydrated
 * registry singletons; returns null until hydration completes (no chips, no
 * diagnostics — never a wrong "unknown").
 */
export function getFrontmatterReferenceProvider(): FrontmatterReferenceProvider | null {
  const effortRegistry = getAppEffortRegistry();
  const equipmentRegistry = getAppEquipmentRegistry();
  // Null until BOTH registries hydrate — never diagnose against a half-loaded catalog.
  if (!effortRegistry.isInitialized() || !equipmentRegistry.isInitialized()) return null;
  const snapshot: CatalogSnapshot = {
    efforts: [...effortRegistry.list()],
    equipment: [...equipmentRegistry.list()],
  };
  const signature = catalogSignature(snapshot);
  if (!providerCache || providerCache.signature !== signature) {
    const index = createReferenceIndex(snapshot);
    providerCache = { index, provider: buildProvider(index), signature };
  }
  return providerCache.provider;
}

/**
 * The same shared ReferenceIndex the provider wraps, for hosts that take
 * the raw index (e.g. `createParser({ references })`). Null until both
 * registries hydrate.
 */
export function getSharedReferenceIndex(): ReferenceIndex | null {
  getFrontmatterReferenceProvider();
  return providerCache?.index ?? null;
}

/**
 * Extension wiring the shared reference resolver into the editor facets,
 * plus a reload listener: a seed-import broadcast forces the frontmatter
 * preview to rebuild against the refreshed catalog.
 */
export function createFrontmatterReferenceProvider(): Extension {
  const reloadListener = ViewPlugin.fromClass(
    class {
      private readonly channel: BroadcastChannel | null = null;
      private readonly onSeed = () => {
        this.view.dispatch({ effects: referenceIndexReload.of(null) });
      };
      constructor(private readonly view: EditorView) {
        if (typeof BroadcastChannel !== 'undefined') {
          this.channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
          this.channel.onmessage = this.onSeed;
        }
      }
      destroy() {
        this.channel?.close();
      }
    },
  );
  return [frontmatterReferenceIndex.of(getFrontmatterReferenceProvider), reloadListener];
}

/** Catalog rows for palette pickers and completions (registry-backed). */
export async function loadReferenceCatalog(): Promise<CatalogSnapshot> {
  const effortRegistry = getAppEffortRegistry();
  return {
    efforts: [...effortRegistry.list()],
    equipment: [...getAppEquipmentRegistry().list()],
  };
}

/**
 * Flat `metrics.*` note defaults for the reference resolver (executable
 * keys only): `metrics.effort` + `metrics.equipment`. Read from the full
 * document so section-scoped parses (focused-line chips, runtime) honor
 * the note defaults without each caller re-parsing frontmatter.
 */
export function readNoteReferenceDefaults(source: string): ReferenceResolutionDefaults {
  const { meta } = parseFrontmatter(source);
  const effortValue = meta['metrics.effort'];
  const effort = typeof effortValue === 'string' && effortValue.trim() ? effortValue.trim() : undefined;
  const equipmentValue = meta['metrics.equipment'];
  const equipment = (Array.isArray(equipmentValue) ? equipmentValue : [equipmentValue])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return {
    ...(effort ? { effort } : {}),
    ...(equipment.length > 0 ? { equipment } : {}),
  };
}

/** Palette source over the effort/equipment catalog; optional slug allow-list for diagnostics repair. */
export function referencePaletteSource(
  kind: 'effort' | 'equipment',
  candidateSlugs?: readonly string[],
): PaletteDataSource {
  return {
    id: `reference:${kind}`,
    label: kind === 'effort' ? 'Effort' : 'Equipment',
    search: async (query) => {
      const catalog = await loadReferenceCatalog();
      const rows = kind === 'effort' ? catalog.efforts : catalog.equipment;
      const pool = candidateSlugs ? rows.filter((row) => candidateSlugs.includes(row.slug)) : rows;
      const items: PaletteItem[] = pool.map((row) => ({
        id: row.slug,
        label: `${row.label} (${row.slug})`,
        category: kind === 'effort' ? 'Effort' : 'Equipment',
        type: 'statement-part',
        payload: row.slug,
      }));
      if (!query) return items;
      const q = query.toLowerCase();
      return items.filter((item) => item.label.toLowerCase().includes(q));
    },
  };
}

// ── Focused-line reference JSON authoring ─────────────────────────────
// Malformed suffixes are detected and REFUSED for structured rewrites —
// they stay verbatim in the source, never duplicated or dropped.

export interface LineRefs {
  effort?: string;
  equipment: string[];
  /** Char range of the parsed JSON suffix within the line. */
  jsonFrom: number;
  jsonTo: number;
  /** Trailing JSON exists but does not parse — structured writes must refuse. */
  malformed: boolean;
  /** Parsed JSON contains non-string reference values — rewrite would lose them. */
  hasInvalidEntries: boolean;
}

/**
 * Extract a trailing JSON object from a line. Handles braces nested inside
 * JSON strings by attempting a parse from each opening brace, last first
 * (reference suffixes are short; the cap keeps pathological lines cheap).
 */
function extractTrailingJson(lineText: string): { json: string; from: number; to: number } | null {
  const trimmed = lineText.trimEnd();
  if (!trimmed.endsWith("}")) return null;
  let attempts = 0;
  for (let i = trimmed.length - 1; i >= 0 && attempts < 24; i--) {
    if (trimmed[i] !== "{") continue;
    attempts++;
    const candidate = trimmed.slice(i);
    try {
      JSON.parse(candidate);
      return { json: candidate, from: i, to: i + candidate.length };
    } catch {
      // keep scanning left for an outer object
    }
  }
  return null;
}

/**
 * Parse a statement line's trailing reference JSON. `malformed` marks a
 * JSON-looking suffix that does not parse; `hasInvalidEntries` marks parsed
 * JSON whose effort/equipment values are not strings — both must be fixed
 * in the raw source, never rewritten by the structured paths.
 */
export function parseLineRefs(lineText: string): LineRefs {
  const extracted = extractTrailingJson(lineText);
  if (!extracted) {
    return { equipment: [], jsonFrom: -1, jsonTo: -1, malformed: false, hasInvalidEntries: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.json);
  } catch {
    return { equipment: [], jsonFrom: extracted.from, jsonTo: extracted.to, malformed: true, hasInvalidEntries: false };
  }
  let hasInvalidEntries = false;
  let effort: string | undefined;
  const equipment: string[] = [];
  if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (record.effort !== undefined) {
      if (typeof record.effort === 'string' && record.effort.trim()) effort = record.effort.trim();
      else hasInvalidEntries = true;
    }
    if (record.equipment !== undefined) {
      const values = Array.isArray(record.equipment) ? record.equipment : [record.equipment];
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) equipment.push(value.trim());
        else hasInvalidEntries = true;
      }
    }
  } else {
    hasInvalidEntries = true;
  }
  return { effort, equipment, jsonFrom: extracted.from, jsonTo: extracted.to, malformed: false, hasInvalidEntries };
}

/**
 * Merge reference updates into a line, replacing a valid JSON suffix or
 * appending one. The original parsed object is merged — unrelated keys
 * (rpe, resistance, notes, …) survive untouched; only the requested
 * effort/equipment keys change. Returns the line UNCHANGED when the
 * existing suffix is malformed or holds non-string values — the caller
 * keeps the authored source and surfaces the diagnostic instead.
 */
export function buildLineWithRefs(
  lineText: string,
  updates: { effort?: string | null; equipment?: string[] },
): string {
  const existing = parseLineRefs(lineText);
  if (existing.malformed || existing.hasInvalidEntries) return lineText;
  const base = existing.jsonFrom >= 0 ? lineText.slice(0, existing.jsonFrom).trimEnd() : lineText.trimEnd();
  let merged: Record<string, unknown> = {};
  if (existing.jsonFrom >= 0) {
    try {
      merged = JSON.parse(lineText.slice(existing.jsonFrom, existing.jsonTo)) as Record<string, unknown>;
    } catch {
      return lineText;
    }
  }
  if (updates.effort !== undefined) {
    if (updates.effort === null) delete merged.effort;
    else merged.effort = updates.effort;
  }
  if (updates.equipment !== undefined) {
    if (updates.equipment.length === 0) delete merged.equipment;
    else merged.equipment = updates.equipment;
  }
  if (Object.keys(merged).length === 0) return base;
  return `${base} ${JSON.stringify(merged)}`;
}

export function resolveNotePersistence(
  cache: { current: INotePersistence | null },
  provided?: INotePersistence,
): INotePersistence {
  if (provided) {
    return provided;
  }

  if (!cache.current) {
    cache.current = new IndexedDBNotePersistence();
  }

  return cache.current;
}

export function createFileDropHandler(
  noteId: string | undefined,
  notePersistence: INotePersistence,
): Extension {
  return EditorView.domEventHandlers({
    drop: (event, view) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return false;

      event.preventDefault();

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      Array.from(files).forEach(async (file) => {
        const id = uuidv7();
        const reader = new FileReader();

        reader.onload = async () => {
          const data = reader.result as ArrayBuffer;

          if (noteId) {
            try {
              await notePersistence.mutateNote(noteId, {
                attachments: {
                  add: [{
                    id,
                    file: new File([data], file.name, { type: file.type }),
                  }],
                },
              });
            } catch (error) {
              appWarn('NoteEditor', 'Attachment persist skipped:', error);
            }
          }

          const isImage = file.type.startsWith('image/');
          const prefix = isImage ? '!' : '';
          const markdown = `\n${prefix}[${file.name}](${id})\n`;

          view.dispatch({
            changes: { from: pos, insert: markdown },
            selection: { anchor: pos + markdown.length },
          });
        };

        reader.readAsArrayBuffer(file);
      });

      return true;
    },
  });
}
