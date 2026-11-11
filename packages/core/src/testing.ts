/**
 * Canonical GLOSSARY.md domain fixture builders.
 *
 * Pure TypeScript — zero DOM/Node/libsql dependencies, safe for every host
 * (browser, Node, Storybook, headless vitest). All ids and timestamps are
 * deterministic functions of the inputs so `buildDomainWorld` snapshots are
 * reproducible: no `Date.now()`, no `crypto.randomUUID()`.
 */
import { blockContentId, parseDocumentSections, reconcileNoteBlocks } from './sections';
import type { FeedOrigin } from './types/feed';
import type {
  BlockEquipment,
  BlockEffort,
  BlockIndexRow,
  BlockRevision,
  EventRecord,
  Note,
  NoteBlock,
  NoteProvenance,
  NoteTag,
  NotebookLink,
  OverridePropertyKind,
  Page,
  PageNote,
  ResultOrigin,
  ScopedPropertyOverride,
  Session,
  Tag,
} from './types/storage';

/** Fixed epoch (2024-01-01T00:00:00Z) for every derived timestamp. */
export const TEST_EPOCH = 1704067200000 as const;

// ---------------------------------------------------------------------------
// buildTestNote
// ---------------------------------------------------------------------------

export interface TestNoteInput {
  id?: string;
  title?: string;
  rawContent: string;
  type?: Note['type'];
  date?: number;
  createdAt?: number;
  sourceRevision?: number;
  seedOrigin?: 'seed' | 'user';
  feedOrigin?: FeedOrigin;
  sourceId?: string;
  sourcePath?: string;
  feedSourceId?: string;
  priorBlocks?: Record<string, NoteBlock>;
  notebookId?: string;
  notebookIds?: string[];
  tags?: string[];
  provenance?: NoteProvenance;
}

export interface BuiltTestNote {
  note: Note;
  revisions: BlockRevision[];
  blockIndex: BlockIndexRow[];
  blockEfforts: BlockEffort[];
  blockEquipment: BlockEquipment[];
  tags: Tag[];
  noteTags: NoteTag[];
  notebookLinks: NotebookLink[];
}

/** One resolvable effort/equipment mention: canonical slug + matching phrases. */
interface MentionEntry {
  slug: string;
  phrases: string[];
}

/**
 * Effort/equipment vocabulary registered by `buildPropertyNote` in this
 * process. Mirrors runtime mention resolution (words are matched against the
 * registry), simplified to exact word-boundary phrase matches.
 * ponytail: process-global vocabulary — reset via `resetTestingVocabulary()`
 * in test setup if cross-suite leakage ever matters.
 */
const EFFORT_VOCABULARY: MentionEntry[] = [];
const EQUIPMENT_VOCABULARY: MentionEntry[] = [];

/** Clear the process-global property vocabulary (test isolation helper). */
export function resetTestingVocabulary(): void {
  EFFORT_VOCABULARY.length = 0;
  EQUIPMENT_VOCABULARY.length = 0;
}

function slugifyText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][^:#]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlMapEntries(record: Record<string, unknown>): string[] {
  return Object.entries(record).map(([key, value]) =>
    `  ${key}: ${typeof value === 'string' ? yamlScalar(value) : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}`,
  );
}

function yamlListLines(key: string, items: readonly string[]): string[] {
  return items.length > 0 ? [`${key}:`, ...items.map(item => `  - ${yamlScalar(item)}`)] : [`${key}: []`];
}

function mentionPhraseRegex(entry: MentionEntry): RegExp {
  const alternatives = [...new Set(entry.phrases.map(phrase => phrase.trim()).filter(Boolean))]
    .map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<![\\w-])(?:${alternatives})(?![\\w-])`, 'i');
}

function scanMentions(content: string, vocabulary: readonly MentionEntry[]): string[] {
  const slugs: string[] = [];
  for (const entry of vocabulary) {
    if (slugs.includes(entry.slug)) continue;
    if (mentionPhraseRegex(entry).test(content)) slugs.push(entry.slug);
  }
  return slugs;
}

function slugToMentionEntry(slug: string, label: string, aliases: readonly string[]): MentionEntry {
  return { slug, phrases: [slug, label, ...aliases] };
}

/**
 * Build a full Note aggregate: the Note itself, its block revision history,
 * WQL block-index projections, effort/equipment containment rows, tag rows
 * and notebook membership links.
 *
 * Block occurrence ids are deterministic (`blk-0`, `blk-1`, … in document
 * order) and `BlockIndexRow.blockContentId` carries the real content
 * fingerprint for wod blocks, so sessions can pin by content.
 */
export function buildTestNote(input: TestNoteInput): BuiltTestNote {
  const noteId = input.id ?? `note-${input.title ? slugifyText(input.title) : blockContentId(input.rawContent)}`;
  const createdAt = input.createdAt ?? TEST_EPOCH;
  const sourceRevision = input.sourceRevision ?? 1;
  const rawContent = input.rawContent;
  const title = input.title ?? 'Untitled';

  let ordinal = 0;
  const blocks: Record<string, NoteBlock> = reconcileNoteBlocks(rawContent, {
    sourceRevision,
    blocks: input.priorBlocks,
    createId: () => {
      let candidate = `blk-${ordinal++}`;
      while (input.priorBlocks && Object.hasOwn(input.priorBlocks, candidate)) {
        candidate = `blk-${ordinal++}`;
      }
      return candidate;
    },
  });

  const effectiveFeedOrigin = input.feedOrigin ?? (input.feedSourceId ? 'feed' : undefined);
  const effectiveSeedOrigin = input.seedOrigin ?? (effectiveFeedOrigin === 'feed' ? 'seed' : undefined);
  const sections = parseDocumentSections(rawContent);
  const revisions: BlockRevision[] = [];
  const blockIndex: BlockIndexRow[] = [];
  const blockEfforts: BlockEffort[] = [];
  const blockEquipment: BlockEquipment[] = [];
  const isStatic = effectiveSeedOrigin === 'seed';
  for (const [position, block] of Object.values(blocks).entries()) {
    const slice = rawContent.slice(block.from, block.to);
    // With prior lineage, only newly added or version-bumped blocks emit a
    // revision — unchanged blocks already hold their immutable row.
    if (input.priorBlocks?.[block.id]?.version !== block.version) {
      revisions.push({
        noteId,
        blockId: block.id,
        version: block.version,
        kind: block.kind,
        rawContent: slice,
        savedAt: createdAt,
        ...(block.dialect ? { dialect: block.dialect } : {}),
        ...(block.sport ? { sport: block.sport } : {}),
      });
    }

    const section = sections.find(s => s.from === block.from && s.to === block.to);
    const contentId = block.kind === 'wod' ? (section?.scriptBlock?.contentId ?? blockContentId(slice)) : undefined;
    blockIndex.push({
      id: `${noteId}:${block.id}`,
      noteId,
      blockId: block.id,
      blockVersion: block.version,
      sourceRevision,
      from: block.from,
      to: block.to,
      position,
      dataType: block.kind,
      ...(contentId ? { blockContentId: contentId } : {}),
      rawContent: slice,
      noteTitle: title,
      createdAt,
      isStatic,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
      ...(input.notebookId ? { notebookId: input.notebookId } : {}),
    });

    if (block.kind === 'wod') {
      const body = section?.scriptBlock?.content ?? slice;
      for (const slug of scanMentions(body, EFFORT_VOCABULARY)) {
        blockEfforts.push({
          id: `${noteId}:${block.id}:${slug}`,
          noteId,
          blockId: block.id,
          ...(contentId ? { blockContentId: contentId } : {}),
          effortSlug: slug,
          isStatic,
          ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
          createdAt,
        });
      }
      for (const slug of scanMentions(body, EQUIPMENT_VOCABULARY)) {
        blockEquipment.push({
          id: `${noteId}:${block.id}:${slug}`,
          noteId,
          blockId: block.id,
          ...(contentId ? { blockContentId: contentId } : {}),
          equipmentSlug: slug,
          isStatic,
          ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
          createdAt,
        });
      }
    }
  }

  const tags: Tag[] = [];
  const noteTags: NoteTag[] = [];
  for (const label of input.tags ?? []) {
    const tag: Tag = { id: `tag:${label}`, label, createdAt };
    if (!tags.some(t => t.id === tag.id)) tags.push(tag);
    noteTags.push({ id: `${noteId}:${tag.id}`, noteId, tagId: tag.id });
  }

  const notebookIds = input.notebookIds ?? (input.notebookId ? [input.notebookId] : undefined);
  const primaryNotebookId = input.notebookId ?? notebookIds?.[0];
  const notebookLinks: NotebookLink[] = (notebookIds ?? []).map(nbId => ({
    id: `${nbId}:note:${noteId}`,
    notebookId: nbId,
    targetKind: 'note',
    targetId: noteId,
    noteId,
    createdAt,
  }));

  const note: Note = {
    id: noteId,
    title,
    rawContent,
    sourceRevision,
    blocks,
    ...(input.date !== undefined ? { date: input.date } : {}),
    createdAt,
    ...(input.type ? { type: input.type } : {}),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(primaryNotebookId ? { notebookId: primaryNotebookId } : {}),
    ...(notebookIds ? { notebookIds } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(effectiveSeedOrigin ? { seedOrigin: effectiveSeedOrigin } : {}),
    ...(effectiveFeedOrigin ? { feedOrigin: effectiveFeedOrigin } : {}),
    ...(input.feedSourceId ? { feedSourceId: input.feedSourceId } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
  };

  return { note, revisions, blockIndex, blockEfforts, blockEquipment, tags, noteTags, notebookLinks };
}

// ---------------------------------------------------------------------------
// buildPropertyNote
// ---------------------------------------------------------------------------

export interface TestPropertyNoteInput {
  id?: string;
  kind: OverridePropertyKind;
  slug: string;
  label: string;
  notebookId?: string;
  aliases?: string[];
  metrics?: Record<string, string | number>;
  summaries?: Record<string, string | number>;
  baseAttributes?: Record<string, unknown>;
  body?: string;
  seedOrigin?: 'seed' | 'user';
  feedSourceId?: string;
  asOverride?: boolean;
}

export interface BuiltPropertyNote {
  note: Note;
  override?: ScopedPropertyOverride;
}

/**
 * Build a Property Note (effort | equipment | tag | tag-type) with valid
 * YAML frontmatter — `parseEffortFile` / `parseEquipmentFile` /
 * `documentToTag` can consume the result unchanged. When `asOverride` is set
 * (or a notebook scope other than `notebook/defaults` is given) the matching
 * `ScopedPropertyOverride` row is emitted alongside the Note.
 *
 * Effort/equipment slugs register into the mention vocabulary so later
 * `buildTestNote` calls link containing blocks automatically.
 */
export function buildPropertyNote(input: TestPropertyNoteInput): BuiltPropertyNote {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) throw new Error('Property note requires a non-empty canonical slug.');
  const kind = input.kind;
  const aliases = input.aliases ?? [];
  const entityId = input.id ?? `${kind}-${slug}`;

  const lines: string[] = ['---'];
  lines.push(`id: ${yamlScalar(entityId)}`);
  if (kind === 'equipment') lines.push('type: equipment');
  if (kind === 'tag-type') lines.push('type: tag-type');
  lines.push(`slug: ${yamlScalar(slug)}`);
  lines.push(`label: ${yamlScalar(input.label)}`);
  lines.push(...yamlListLines('aliases', aliases));
  if (input.metrics && Object.keys(input.metrics).length > 0) {
    lines.push('metrics:', ...yamlMapEntries(input.metrics));
  }
  if (input.summaries && Object.keys(input.summaries).length > 0) {
    lines.push('summaries:', ...yamlMapEntries(input.summaries));
  }
  // Effort definitions require a positive `baseAttributes.met` to parse.
  const baseAttributes: Record<string, unknown> = {
    ...(kind === 'effort' ? { met: 5.0 } : {}),
    ...input.baseAttributes,
  };
  if (Object.keys(baseAttributes).length > 0) {
    lines.push('baseAttributes:', ...yamlMapEntries(baseAttributes));
  }
  lines.push('---');
  if (input.body?.trim()) {
    lines.push('', input.body.trim(), '');
  }
  const rawContent = lines.join('\n');

  const createdAt = TEST_EPOCH;
  const seedOrigin = input.seedOrigin ?? 'user';
  const notebookId = input.notebookId !== undefined ? input.notebookId : input.asOverride ? 'notebook/custom' : undefined;
  const wantsOverride = input.asOverride === true || (notebookId !== undefined && notebookId !== 'notebook/defaults');
  const nbSlug = notebookId !== undefined && notebookId.startsWith('notebook/') ? notebookId.slice('notebook/'.length) : notebookId;
  const ownerNoteId = `override/${nbSlug}/${kind}/${slug}`;
  const note: Note = {
    id: input.id ?? (wantsOverride && notebookId ? ownerNoteId : `property/${kind}/${slug}`),
    title: input.label,
    rawContent,
    sourceRevision: 1,
    blocks: {},
    createdAt,
    seedOrigin,
    ...(input.feedSourceId ? { feedSourceId: input.feedSourceId, feedOrigin: 'feed' as const } : {}),
  };

  if (kind === 'effort') {
    EFFORT_VOCABULARY.push(slugToMentionEntry(slug, input.label, aliases));
  } else if (kind === 'equipment') {
    EQUIPMENT_VOCABULARY.push(slugToMentionEntry(slug, input.label, aliases));
  }

  let override: ScopedPropertyOverride | undefined;
  if (wantsOverride && notebookId !== undefined) {
    const payload: Record<string, unknown> =
      kind === 'effort'
        ? { id: entityId, slug, label: input.label, aliases, baseAttributes, registrySource: 'user', ownerNoteId, sourceId: notebookId, updatedAt: new Date(createdAt).toISOString() }
        : kind === 'equipment'
          ? { id: entityId, slug, label: input.label, aliases, registrySource: 'user', ownerNoteId, sourceId: notebookId, updatedAt: new Date(createdAt).toISOString() }
          : kind === 'tag'
            ? { id: entityId, label: slug, type: 'tag', contributions: [], createdAt }
            : { id: entityId, name: slug, label: input.label, createdAt };
    override = {
      id: `${notebookId}:${kind}:${slug}`,
      notebookId,
      kind,
      slug,
      label: input.label,
      ownerNoteId,
      rawContent,
      payload,
      seedOrigin,
      ...(input.feedSourceId ? { feedSourceId: input.feedSourceId } : {}),
      updatedAt: createdAt,
    };
  }

  return { note, override };
}

// ---------------------------------------------------------------------------
// buildTestSession
// ---------------------------------------------------------------------------

export interface TestSessionInput {
  id?: string;
  noteId: string;
  blockId?: string;
  blockVersion?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  origin?: ResultOrigin;
  isPublic?: boolean;
  notebookIds?: string[];
  events?: Array<Partial<EventRecord> & { id?: string }>;
}

export interface BuiltTestSession {
  session: Session;
  events: EventRecord[];
  notebookLinks: NotebookLink[];
}

/**
 * Build a Session execution log plus its EventRecord rows, pinned to
 * `noteId`/`blockId`/`blockVersion`. Without an explicit block pin the first
 * wod occurrence (`blk-0`) of a `buildTestNote` note is assumed. Session ids
 * default to `session-${noteId}:1`; pass explicit ids when authoring several
 * sessions against one note outside a `buildDomainWorld` sequence.
 */
export function buildTestSession(input: TestSessionInput): BuiltTestSession {
  return buildTestSessionAt(input, 1);
}

/** World-aware variant: `sequence` disambiguates default session ids. */
function buildTestSessionAt(input: TestSessionInput, sequence: number): BuiltTestSession {
  const noteId = input.noteId;
  const blockId = input.blockId ?? 'blk-0';
  const blockVersion = input.blockVersion ?? 1;
  const startedAt = input.startedAt ?? TEST_EPOCH;
  const durationMs = input.durationMs ?? 3_600_000;
  const endTime = input.completedAt ?? startedAt + durationMs;

  const session: Session = {
    id: input.id ?? `session-${noteId}:${sequence}`,
    noteId,
    blockId,
    blockVersion,
    origin: input.origin ?? 'journal',
    status: 'completed',
    startTime: startedAt,
    endTime,
    duration: endTime - startedAt,
    completed: true,
    createdAt: startedAt,
    ...(input.isPublic !== undefined ? { public: input.isPublic } : {}),
    ...(input.notebookIds ? { notebookIds: input.notebookIds } : {}),
  };

  const events: EventRecord[] = (input.events ?? []).map((event, index) => {
    const record: EventRecord = {
      id: event.id ?? `${session.id}:${index}`,
      resultId: session.id,
      noteId,
      timestamp: startedAt,
      grain: 'event',
      outputType: 'event',
      metrics: [],
      ...event,
    };
    if (record.blockId === undefined) record.blockId = blockId;
    if (record.blockVersion === undefined) record.blockVersion = blockVersion;
    return record;
  });

  const notebookLinks: NotebookLink[] = (input.notebookIds ?? []).map(nbId => ({
    id: `${nbId}:session:${session.id}`,
    notebookId: nbId,
    targetKind: 'session',
    targetId: session.id,
    noteId,
    createdAt: startedAt,
  }));

  return { session, events, notebookLinks };
}

// ---------------------------------------------------------------------------
// buildDomainWorld
// ---------------------------------------------------------------------------

export interface DomainWorldInput {
  notes?: TestNoteInput[];
  propertyNotes?: TestPropertyNoteInput[];
  sessions?: TestSessionInput[];
  pages?: Page[];
  pageNotes?: PageNote[];
}

export interface DomainWorld {
  notes: Note[];
  revisions: BlockRevision[];
  blockIndex: BlockIndexRow[];
  blockEfforts: BlockEffort[];
  blockEquipment: BlockEquipment[];
  tags: Tag[];
  noteTags: NoteTag[];
  notebooks: Note[];
  notebookLinks: NotebookLink[];
  propertyOverrides: ScopedPropertyOverride[];
  pages: Page[];
  pageNotes: PageNote[];
  sessions: Session[];
  events: EventRecord[];
}

/**
 * Aggregate a complete deterministic domain snapshot: Notes, Property Notes
 * with their Scoped Property Overrides, notebook landing notes for every
 * referenced notebook, NotebookLinks, pages, sessions and events.
 *
 * Property notes are built FIRST so effort/equipment mentions in note
 * content resolve against their vocabulary; sessions then pin to the first
 * wod block of their note (real block id, version and content fingerprint).
 */
export function buildDomainWorld(input: DomainWorldInput = {}): DomainWorld {
  // Property notes first: their slugs feed the mention vocabulary used by
  // every subsequent buildTestNote call below.
  const builtProperties = (input.propertyNotes ?? []).map(buildPropertyNote);

  const builtNotes = (input.notes ?? []).map(buildTestNote);

  const world: DomainWorld = {
    notes: [],
    revisions: [],
    blockIndex: [],
    blockEfforts: [],
    blockEquipment: [],
    tags: [],
    noteTags: [],
    notebooks: [],
    notebookLinks: [],
    propertyOverrides: [],
    pages: input.pages ?? [],
    pageNotes: input.pageNotes ?? [],
    sessions: [],
    events: [],
  };

  const firstWodBlockByNote = new Map<string, { blockId: string; blockVersion: number; blockContentId?: string }>();
  for (const built of builtNotes) {
    world.notes.push(built.note);
    world.revisions.push(...built.revisions);
    world.blockIndex.push(...built.blockIndex);
    world.blockEfforts.push(...built.blockEfforts);
    world.blockEquipment.push(...built.blockEquipment);
    world.tags.push(...built.tags);
    world.noteTags.push(...built.noteTags);
    world.notebookLinks.push(...built.notebookLinks);
    const firstWod = built.blockIndex.find(row => row.dataType === 'wod');
    if (firstWod) {
      firstWodBlockByNote.set(built.note.id, {
        blockId: firstWod.blockId,
        blockVersion: firstWod.blockVersion,
        ...(firstWod.blockContentId ? { blockContentId: firstWod.blockContentId } : {}),
      });
    }
  }

  for (const { note, override } of builtProperties) {
    world.notes.push(note);
    if (override) {
      world.propertyOverrides.push(override);
      if (!world.notebooks.some(nb => nb.id === override.notebookId)) world.notebooks.push(notebookLandingNote(override.notebookId));
    }
  }

  let sessionSequence = 0;
  for (const sessionInput of input.sessions ?? []) {
    sessionSequence++;
    const pin = firstWodBlockByNote.get(sessionInput.noteId);
    const built = buildTestSessionAt(
      {
        ...sessionInput,
        ...(sessionInput.blockId === undefined && pin ? { blockId: pin.blockId, blockVersion: pin.blockVersion } : {}),
      },
      sessionSequence,
    );
    const blockContentId = built.session.blockContentId ?? pin?.blockContentId;
    const session: Session = { ...built.session, ...(blockContentId ? { blockContentId } : {}) };
    world.sessions.push(session);
    world.events.push(...built.events);
    world.notebookLinks.push(...built.notebookLinks);
  }

  // Landing notes for every notebook referenced by notes or sessions.
  const referencedNotebooks = new Set<string>();
  for (const link of world.notebookLinks) referencedNotebooks.add(link.notebookId);
  for (const nbId of referencedNotebooks) {
    if (!world.notebooks.some(nb => nb.id === nbId)) world.notebooks.push(notebookLandingNote(nbId));
  }

  return world;
}

/** Deterministic notebook landing note (`notebook/{slug}` id convention). */
function notebookLandingNote(notebookId: string): Note {
  const slug = notebookId.startsWith('notebook/') ? notebookId.slice('notebook/'.length) : notebookId;
  return {
    id: notebookId,
    title: slug.charAt(0).toUpperCase() + slug.slice(1),
    rawContent: '',
    sourceRevision: 1,
    blocks: {},
    createdAt: TEST_EPOCH,
  };
}
