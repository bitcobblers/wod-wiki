/**
 * DomainScenarioHarness — GLOSSARY.md business-language test driver over a
 * real `SqlStorage(':memory:')` database with the production `QueryService`
 * wired to its live stores (closing the WQL-over-SqlStorage integration gap).
 *
 * Fixtures come from `@bitcobblers/wod-wiki-core/testing`; every method speaks
 * domain nouns (Note, Property Note, Session, Publication Visibility) rather
 * than store/SQL vocabulary.
 */
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import type { IStorageTransaction, KeyDTO, RangeDTO, StoreName, StoreType } from '@bitcobblers/wod-wiki-storage';
import {
  buildDomainWorld,
  buildPropertyNote,
  buildTestNote,
  type BuiltPropertyNote,
  type BuiltTestNote,
  type DomainWorld,
  type DomainWorldInput,
  type TestNoteInput,
  type TestPropertyNoteInput,
} from '@bitcobblers/wod-wiki-core/testing';
import { toEventRows } from '@bitcobblers/wod-wiki-wql';
import {
  MetricContainer,
  MetricType,
  QueryService,
  ScriptRuntime,
  RuntimeStack,
  EventBus,
  StartSessionAction,
  applySeedChunk,
  checkUnpublishedFeedChanges,
  createCompiler,
  createMockClock,
  createParser,
  emptySeedMeta,
  extractPropertyRulesFromMeta,
  getNotePublicationSummary,
  isFindQuery,
  MemoryFeedTree,
  parseQuery,
  prepareJournalSessionRun,
  promoteNoteToNotebooks,
  publishFeedFromStorage,
  resolveEntityScope as resolveEntityScopeWql,
  resolveScopedPropertyCatalog,
  resolveUpstreamProvenance,
  runMetricShakeOutQueue,
  saveScopedPropertyOverride,
  seedMetaKey,
  setNotebookPublic,
  setSessionPublic,
  toStoredOutputStatement,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockQueryStore,
  type BlockRevision,
  type EffortQueryStore,
  type EntityScopeDescriptor,
  type EventRecord,
  type EventStore,
  type IOutputStatement,
  type Note,
  type NoteProvenance,
  type NoteQueryStore,
  type NotebookLink,
  type NoteTag,
  type Page,
  type PageNote,
  type PropertyResolutionContext,
  type PropertyRuleInput,
  type PublishFeedOptions,
  type PublishFeedReport,
  type QueryOptions,
  type QueryResult,
  type QueryServiceStores,
  type ResolveEntityScopeInput,
  type ResolvedUpstreamProvenance,
  type ResultOrigin,
  type SaveScopedPropertyOverrideInput,
  type ScopedPropertyOverride,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedRow,
  type Session,
  type ShakeOutResult,
  type SkippedDependencyDiagnostic,
  type Tag,
  type TagTypeRecord,
} from '../../src/index';

// ── Public input/result shapes ──────────────────────────────────────────────

export interface SessionRunInput {
  /** Note to run — read-only Feed/Seed Notes are cloned into `notebook/journal` first. */
  noteId: string;
  /** Block occurrence to run; defaults to the Note's first workout block. */
  blockId?: string;
  sessionId?: string;
  /** Civil journal date (`YYYY-MM-DD`) the run lands on. */
  journalDate?: string;
  /** Run start epoch-ms (also seeds the mock runtime clock). */
  startedAt?: number;
  origin?: ResultOrigin;
  /** Clock advances (ms) applied before each `next`; cycled. Default `[10_000]`. */
  advances?: number[];
  /** Safety cap on `next` dispatches. Default `64`. */
  maxNexts?: number;
}

export interface SessionRunResult {
  sessionId: string;
  /** The Note the Session is pinned to — the Journal clone for read-only sources. */
  noteId: string;
  clonedFromReadOnly: boolean;
  provenance?: NoteProvenance;
  session: Session;
  outputs: IOutputStatement[];
  events: EventRecord[];
  /** Live upstream lineage at run time. */
  upstream?: ResolvedUpstreamProvenance;
}

export interface PromoteNoteInput {
  noteId: string;
  notebookIds: string[];
  sessionIds?: string[];
  shareSessionsPublicly?: boolean;
}

export type ShakeOutLayerName = 'tag' | 'effort' | 'equipment' | 'note' | 'category';

export interface ShakeOutSourceInput {
  layer: ShakeOutLayerName;
  slug: string;
  metrics: Record<string, string | number>;
  summaries?: Record<string, string | number>;
}

export interface ShakeOutScenarioInput {
  /** Statement-layer metrics seeding the container (parser currency). */
  metrics: Array<{ type: MetricType; value: number; unit?: string; origin?: string }>;
  /** Queue stage: 'plan' defers runtime atoms, 'log' emits diagnostics. Default 'log'. */
  stage?: 'plan' | 'log';
  /** Runtime `elapsed` atom appended at log stage (ms). */
  elapsedMs?: number;
  /** Explicit property layers; when omitted, derived from the resolved Property catalog. */
  sources?: ShakeOutSourceInput[];
  /** Catalog resolution scope (note/notebook + inheritance mode) for derived sources. */
  scope?: PropertyResolutionContext;
  /** Optional shorthand overriding `scope.mode` ('source-first' | 'custom-runtime'). */
  mode?: PropertyResolutionContext['mode'];
}

export interface ShakeOutScenarioResult {
  container: MetricContainer;
  result: ShakeOutResult;
  diagnostics: readonly SkippedDependencyDiagnostic[];
  /** Resolved numeric values by metric type — the business-readable outcome. */
  values: Record<string, { value: number; unit?: string }>;
}

export interface BlockMetricSummary {
  text: string;
  metrics: Array<{ type: string; value: unknown; unit?: string; origin?: string }>;
}

export interface QueryWqlOptions extends QueryOptions {
  range?: { start: number; end: number };
  anchorNow?: number;
  skipContainers?: boolean;
}

/** Deterministic journal epoch for harness runs that omit `startedAt`. */
export const HARNESS_EPOCH = 1_735_689_600_000; // 2025-01-01T00:00:00Z

/** One note's hydration relations — structurally the storage relation slice. */
interface HarnessRelationBundle {
  tags: ReadonlyArray<{ label: string; type?: string }>;
  links: PageNote[];
  pages: Page[];
}

/** Persistable slice of a `DomainWorld` — every row family the fixtures produce. */
interface WorldRowSlice {
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

// ── Harness ─────────────────────────────────────────────────────────────────

export class DomainScenarioHarness {
  readonly storage: SqlStorage;
  readonly queryService: QueryService;

  private constructor(storage: SqlStorage) {
    this.storage = storage;
    this.queryService = new QueryService(this.buildQueryServiceStores());
  }

  static async create(initialWorld?: DomainWorldInput): Promise<DomainScenarioHarness> {
    const harness = new DomainScenarioHarness(
      new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' }))),
    );
    if (initialWorld) await harness.seedWorld(initialWorld);
    return harness;
  }

  // ── Fixture persistence ────────────────────────────────────────────────────

  /** Aggregate a complete deterministic domain snapshot into the live database. */
  async seedWorld(input: DomainWorldInput = {}): Promise<DomainWorld> {
    const world = buildDomainWorld(input);
    await this.persistWorldRows(world);
    return world;
  }

  /** Author a Note with its revisions, block-index projections, containment rows and notebook links. */
  async authorNote(input: TestNoteInput): Promise<BuiltTestNote> {
    const built = buildTestNote(input);
    await this.persistWorldRows({
      notes: [built.note],
      revisions: built.revisions,
      blockIndex: built.blockIndex,
      blockEfforts: built.blockEfforts,
      blockEquipment: built.blockEquipment,
      tags: built.tags,
      noteTags: built.noteTags,
      notebooks: [],
      notebookLinks: built.notebookLinks,
      propertyOverrides: [],
      pages: [],
      pageNotes: [],
      sessions: [],
      events: [],
    });
    return built;
  }

  /**
   * Define a Property Note (Effort / Equipment / Tag / Tag Category) and persist it.
   * Defaults-layer definitions (no notebook scope) materialize as bundled registry
   * rows; scoped definitions persist their Scoped Property Override row.
   */
  async definePropertyNote(input: TestPropertyNoteInput): Promise<BuiltPropertyNote> {
    const built = buildPropertyNote(input);
    await this.storage.transaction(
      ['notes', 'property_overrides', 'efforts', 'equipment', 'tags', 'tag_types'],
      'readwrite',
      async (tx) => {
        await tx.readwrite('notes').put(built.note);
        if (built.override) {
          await this.projectPropertyOverride(tx, built.override);
        } else if ((input.kind === 'effort' || input.kind === 'equipment') && input.notebookId === undefined) {
          // Defaults layer (`notebook/defaults`): a bundled registry definition.
          const baseAttributes = { ...(input.kind === 'effort' ? { met: 5.0 } : {}), ...input.baseAttributes };
          if (input.kind === 'effort') {
            const effort: StoreType<'efforts'> = {
              id: input.id ?? `${input.kind}-${input.slug}`,
              slug: input.slug,
              label: input.label,
              aliases: input.aliases ?? [],
              baseAttributes: baseAttributes as StoreType<'efforts'>['baseAttributes'],
              registrySource: 'bundled',
              sourceId: 'core',
              ...(input.body ? { body: input.body } : {}),
            };
            await tx.readwrite('efforts').put(effort);
          } else {
            const equipment: StoreType<'equipment'> = {
              id: input.id ?? `${input.kind}-${input.slug}`,
              slug: input.slug,
              label: input.label,
              aliases: input.aliases ?? [],
              registrySource: 'bundled',
              sourceId: 'core',
              ...(input.body ? { body: input.body } : {}),
            };
            await tx.readwrite('equipment').put(equipment);
          }
        }
      },
    );
    return built;
  }

  /** Write a Scoped Property Override through the production write path (`notebook/custom` or a shared user Notebook). */
  saveScopedOverride(input: SaveScopedPropertyOverrideInput): Promise<ScopedPropertyOverride> {
    return saveScopedPropertyOverride(this.storage, input);
  }

  // ── Property catalog / Metric Shake-Out Queue ──────────────────────────────

  /**
   * Run the Metric Shake-Out Queue over the statement metrics: property layers
   * stack across Statement > Tag > Effort > Equipment > Note > Tag Category
   * precedence, Summary Metrics compile, and missing required runtime inputs
   * emit Skipped-Dependency Diagnostics.
   */
  async evaluateShakeOut(input: ShakeOutScenarioInput): Promise<ShakeOutScenarioResult> {
    const stage = input.stage ?? 'log';
    const seeds = input.metrics.map((m) => ({ ...m, origin: m.origin ?? 'parser' }));
    if (stage === 'log' && input.elapsedMs !== undefined) {
      seeds.push({ type: MetricType.Elapsed, value: input.elapsedMs, unit: 'ms', origin: 'runtime' });
    }
    const container = MetricContainer.from(seeds);

    const layers = input.sources ?? (await this.deriveShakeOutSources({ ...input.scope, ...(input.mode ? { mode: input.mode } : {}) }));
    const rules: PropertyRuleInput[] = layers.map((layer) =>
      extractPropertyRulesFromMeta(
        {
          metrics: layer.metrics,
          ...(layer.summaries ? { summaries: layer.summaries } : {}),
        },
        layer.layer,
        layer.slug,
      ),
    );
    const result = runMetricShakeOutQueue(container, { stage, sources: rules });

    const values: Record<string, { value: number; unit?: string }> = {};
    for (const metric of container.toArray()) {
      if (metric.type === MetricType.Hint || metric.type === MetricType.Diagnostic) continue;
      if (typeof metric.value === 'number' && Number.isFinite(metric.value)) {
        values[metric.type] = { value: metric.value, ...(metric.unit ? { unit: metric.unit } : {}) };
      }
    }
    return { container, result, diagnostics: result.diagnostics, values };
  }

  // ── Session execution ──────────────────────────────────────────────────────

  /**
   * Run a workout block end-to-end: read-only Feed/Seed Notes are snapshotted
   * into `notebook/journal` via `prepareJournalSessionRun`, the pinned block
   * executes through the real parser + JIT compiler + ScriptRuntime on a mock
   * clock, and the finalized Session plus its EventRecord rows persist to the
   * live SqlStorage stores.
   */
  async prepareAndRunSession(input: SessionRunInput): Promise<SessionRunResult> {
    const startedAt = input.startedAt ?? HARNESS_EPOCH;
    const intake = await prepareJournalSessionRun(this.storage, {
      noteId: input.noteId,
      ...(input.blockId ? { blockId: input.blockId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.journalDate ? { journalDate: input.journalDate } : {}),
      startedAt,
      ...(input.origin ? { origin: input.origin } : {}),
    });

    // Resolve the Note's property scope so efforts resolve to canonical slugs.
    const catalog = await resolveScopedPropertyCatalog(this.storage, { note: intake.note }).catch(() => undefined);
    const script = createParser({
      ...(catalog ? { references: catalog.referenceIndex, tags: catalog.tagIndex } : {}),
    }).read(intake.revision.rawContent);

    const clock = createMockClock(new Date(startedAt));
    const runtime = new ScriptRuntime(script, createCompiler(), {
      stack: new RuntimeStack(),
      clock,
      eventBus: new EventBus(),
    });
    runtime.subscribeToOutput(() => {});
    runtime.do(new StartSessionAction());

    const advances = input.advances ?? [10_000];
    const maxNexts = input.maxNexts ?? 64;
    for (let i = 0; i < maxNexts && runtime.stack.count > 0; i++) {
      const advance = advances[i % advances.length];
      if (advance) clock.advance(advance);
      runtime.handle({ name: 'next', timestamp: clock.currentDate, data: { source: 'domain-scenario-harness' } });
    }
    const outputs = runtime.getOutputStatements();
    runtime.dispose();

    const endTime = clock.currentDate.getTime();
    const session: Session = {
      ...intake.session,
      status: 'completed',
      endTime,
      duration: endTime - startedAt,
      completed: true,
      createdAt: endTime,
    };
    const events = toEventRows(outputs.map(toStoredOutputStatement), {
      noteId: session.noteId,
      resultId: session.id,
      blockId: session.blockId,
      blockVersion: session.blockVersion,
      ...(session.blockContentId ? { blockContentId: session.blockContentId } : {}),
      ...(session.pageId ? { pageId: session.pageId } : {}),
      origin: session.origin ?? input.origin,
      workoutTimestamp: endTime,
    });
    await this.storage.transaction(['sessions', 'events'], 'readwrite', async (tx) => {
      await tx.readwrite('sessions').put(session);
      if (events.length) await tx.readwrite('events').putMany(events);
    });

    return {
      sessionId: session.id,
      noteId: session.noteId,
      clonedFromReadOnly: intake.clonedFromReadOnly,
      ...(intake.note.provenance ? { provenance: intake.note.provenance } : {}),
      session,
      outputs,
      events,
      upstream: await this.upstreamProvenance(session.noteId),
    };
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Execute a WQL query (aggregate / find / pipeline) against the live stores. */
  async queryWql<R = unknown>(wql: string, options?: QueryWqlOptions): Promise<R> {
    const parsed = parseQuery(wql);
    if (isFindQuery(parsed)) {
      return (await this.queryService.runFind(parsed, options)) as R;
    }
    return (await this.queryService.runQuery(wql, options)) as R;
  }

  /** Aggregate-result convenience for `sum:` / `count:` heads. */
  queryAggregate(wql: string, options?: QueryWqlOptions): Promise<QueryResult> {
    return this.queryService.runQuery(wql, options);
  }

  /** Resolve an Entity Scope (Effort / Equipment / Tag / Notebook / Feed / Note) to its WQL planes. */
  resolveEntityScope(entity: ResolveEntityScopeInput): EntityScopeDescriptor {
    return resolveEntityScopeWql(entity);
  }

  /** Read the parsed Metric currency of a block source (unit fusion applied). */
  readBlockMetrics(blockSource: string): BlockMetricSummary[] {
    const script = createParser().read(blockSource);
    return script.statements.map((statement) => {
      const raw = statement.metrics;
      const metrics = raw instanceof MetricContainer ? raw.toArray() : Array.isArray(raw) ? raw : [];
      return {
        text: statement.text ?? '',
        metrics: metrics.map((m) => ({
          type: m.type,
          value: m.value,
          ...(m.unit !== undefined ? { unit: m.unit } : {}),
          ...(m.origin !== undefined ? { origin: m.origin } : {}),
        })),
      };
    });
  }

  /** Live upstream lineage for a (possibly cloned) Note. */
  async upstreamProvenance(noteId: string): Promise<ResolvedUpstreamProvenance | undefined> {
    const note = await this.storage.readonly('notes').get(noteId);
    if (!note) return undefined;
    return resolveUpstreamProvenance(this.storage, note);
  }

  // ── Notebook membership & Publication Visibility ───────────────────────────

  /** Promote a user Note into shared user Notebooks (N:M membership + optional Session sharing). */
  async promoteNoteToNotebooks(input: PromoteNoteInput): Promise<{ notebookIds: string[]; promotedSessionIds: string[] }> {
    const result = await promoteNoteToNotebooks(this.storage, {
      noteId: input.noteId,
      notebookIds: input.notebookIds,
      ...(input.sessionIds ? { sessionIds: input.sessionIds } : {}),
      ...(input.shareSessionsPublicly !== undefined ? { shareSessionsPublicly: input.shareSessionsPublicly } : {}),
    });
    return { notebookIds: result.notebookIds, promotedSessionIds: result.promotedSessionIds };
  }

  setNotebookPublic(notebookId: string, isPublic: boolean): Promise<void> {
    return setNotebookPublic(this.storage, notebookId, isPublic);
  }

  setSessionPublic(sessionId: string, isPublic: boolean): Promise<void> {
    return setSessionPublic(this.storage, sessionId, isPublic);
  }

  /** Derived Publication Visibility of one Note plus its opted-in Session count. */
  publicationSummary(noteId: string) {
    return getNotePublicationSummary(this.storage, noteId);
  }

  /** Detect unpublished changes against an optional already-published tree. */
  unpublishedChanges(tree?: MemoryFeedTree) {
    return checkUnpublishedFeedChanges(this.storage, tree);
  }

  // ── Publication & subscription ─────────────────────────────────────────────

  /** Publish every public Notebook (and its opted-in Sessions) into a fresh in-memory Feed tree. */
  async publishToMemoryFeed(options: PublishFeedOptions = {}): Promise<MemoryFeedTree> {
    const tree = new MemoryFeedTree();
    await publishFeedFromStorage(this.storage, tree, { layout: 'feed', ...options });
    return tree;
  }

  /** Publish and return the report (manifest, counts) alongside the tree. */
  async publishFeed(options: PublishFeedOptions = {}): Promise<{ tree: MemoryFeedTree; report: PublishFeedReport }> {
    const tree = new MemoryFeedTree();
    const report = await publishFeedFromStorage(this.storage, tree, { layout: 'feed', ...options });
    return { tree, report };
  }

  /**
   * Subscribe a fresh harness to a published Feed: the manifest's chunks are
   * applied through the production seed importer (`applySeedChunk`), so the
   * subscriber inherits Seed Notes, opted-in Sessions + telemetry, and
   * promoted Scoped Property Overrides — nothing else.
   */
  async importFeedIntoFreshHarness(tree: MemoryFeedTree, sourceId = 'coach-feed'): Promise<DomainScenarioHarness> {
    const subscriber = await DomainScenarioHarness.create();
    const manifest = JSON.parse(new TextDecoder().decode(await tree.read('manifest.json'))) as SeedManifest;
    const metaKey = seedMetaKey(sourceId);
    let meta: SeedMetaRecord = {
      ...emptySeedMeta(metaKey),
      seedVersion: manifest.version,
      builtAt: manifest.builtAt,
      importedAt: HARNESS_EPOCH,
      tier: 'imported',
    };
    let expected: SeedMetaRecord | undefined;
    for (const chunk of manifest.chunks) {
      const rows = JSON.parse(new TextDecoder().decode(await tree.read(chunk.path))) as SeedRow[];
      const chunkMeta: SeedMetaRecord = {
        ...meta,
        chunks: { ...meta.chunks, [chunk.id]: { sha256: chunk.sha256 } },
      };
      await applySeedChunk(subscriber.storage, {
        chunkId: chunk.id,
        rows,
        manifest,
        expectedMeta: expected,
        meta: chunkMeta,
      });
      expected = chunkMeta;
      meta = chunkMeta;
    }
    return subscriber;
  }

  /** Close the underlying database. */
  async dispose(): Promise<void> {
    await this.storage.close();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Persist a world slice in one transaction. */
  private async persistWorldRows(world: WorldRowSlice): Promise<void> {
    await this.storage.transaction([...WORLD_STORES], 'readwrite', async (tx) => {
      if (world.notes.length) await tx.readwrite('notes').putMany(world.notes);
      if (world.revisions.length) await tx.readwrite('block_revisions').putMany(world.revisions);
      if (world.blockIndex.length) await tx.readwrite('block_index').putMany(world.blockIndex);
      if (world.blockEfforts.length) await tx.readwrite('block_efforts').putMany(world.blockEfforts);
      if (world.blockEquipment.length) await tx.readwrite('block_equipment').putMany(world.blockEquipment);
      if (world.tags.length) await tx.readwrite('tags').putMany(world.tags);
      if (world.noteTags.length) await tx.readwrite('note_tags').putMany(world.noteTags);
      if (world.notebooks.length) await tx.readwrite('notes').putMany(world.notebooks);
      if (world.notebookLinks.length) await tx.readwrite('notebook_links').putMany(world.notebookLinks);
      for (const override of world.propertyOverrides) {
        await this.projectPropertyOverride(tx, override);
      }
      if (world.pages.length) await tx.readwrite('page').putMany(world.pages);
      if (world.pageNotes.length) await tx.readwrite('page_notes').putMany(world.pageNotes);
      if (world.sessions.length) await tx.readwrite('sessions').putMany(world.sessions);
      if (world.events.length) await tx.readwrite('events').putMany(world.events);
    });
  }

  /** Persist one Scoped Property Override and its Tag / Tag Category projections. */
  private async projectPropertyOverride(
    tx: IStorageTransaction,
    override: ScopedPropertyOverride,
  ): Promise<void> {
    await tx.readwrite('property_overrides').put(override);
    if (override.kind === 'tag' && override.payload) {
      // Builder-owned payload — structurally the Tag row (mirrors saveScopedPropertyOverride).
      const tagRow = override.payload as unknown as Tag;
      await tx.readwrite('tags').put(tagRow);
    } else if (override.kind === 'tag-type' && override.payload) {
      // Builder-owned payload — structurally the TagTypeRecord row.
      const tagTypeRow = override.payload as unknown as TagTypeRecord;
      await tx.readwrite('tag_types').put(tagTypeRow);
    }
  }

  /**
   * Derive shake-out property layers from the resolved Property catalog
   * (defaults / feed / custom overrides already precedence-resolved).
   * ponytail: efforts contribute `baseAttributes`, tags/categories their
   * contributions; equipment custom metrics need explicit `sources` until
   * IEquipment carries property payloads.
   */
  private async deriveShakeOutSources(scope?: PropertyResolutionContext): Promise<ShakeOutSourceInput[]> {
    const catalog = await resolveScopedPropertyCatalog(this.storage, scope ?? {});
    const sources: ShakeOutSourceInput[] = [];
    for (const effort of catalog.efforts) {
      const metrics: Record<string, string | number> = {};
      if (typeof effort.baseAttributes?.met === 'number') metrics.met = effort.baseAttributes.met;
      if (Object.keys(metrics).length > 0) sources.push({ layer: 'effort', slug: effort.slug, metrics });
    }
    for (const tag of catalog.tags) {
      const flattened = flattenContributions(tag.contributions);
      if (Object.keys(flattened.metrics).length > 0 || Object.keys(flattened.summaries).length > 0) {
        sources.push({ layer: 'tag', slug: tag.label, ...flattened });
      }
    }
    for (const tagType of catalog.tagTypes) {
      const flattened = flattenContributions(tagType.contributions);
      if (Object.keys(flattened.metrics).length > 0 || Object.keys(flattened.summaries).length > 0) {
        sources.push({ layer: 'category', slug: tagType.name, ...flattened });
      }
    }
    return sources;
  }

  /** Production store seam: every QueryService store reads the live SqlStorage. */
  private buildQueryServiceStores(): QueryServiceStores {
    const storage = this.storage;
    const asRange = (lower: KeyDTO, upper: KeyDTO): RangeDTO => ({ lower, upper });
    const resultRows = (key: string): RangeDTO => asRange([key, ''], [`${key}\uffff`, '\uffff']);

    const eventStore: EventStore = {
      getEventsByTimeRange: async (start, end) => storage.readonly('events').getAllFromIndex('by-timestamp', asRange(start, end)),
      getEventsByResult: async (resultId) => storage.readonly('events').getAllFromIndex('by-result-grain', resultRows(resultId)),
      getEventsForNote: async (noteId) => (await storage.readonly('events').getAll()).filter((row) => row.noteId === noteId),
      getEventsByContent: async (blockContentId) => storage.readonly('events').getAllFromIndex('by-content-grain', resultRows(blockContentId)),
      scanAll: () => storage.readonly('events').getAll(),
      appendEvents: async (rows) => {
        if (rows.length) await storage.readwrite('events').putMany(rows);
      },
      finalizeSummaries: async (resultId, rows) => {
        await storage.transaction(['events'], 'readwrite', async (tx) => {
          const prior = await tx.readonly('events').getAllFromIndex('by-result-grain', {
            lower: [resultId, 'summary'],
            upper: [`${resultId}\uffff`, '\uffff'],
          });
          for (const row of prior) await tx.readwrite('events').delete(row.id);
          if (rows.length) await tx.readwrite('events').putMany(rows);
        });
      },
      deleteEvents: async (ids) => {
        for (const id of ids) await storage.readwrite('events').delete(id);
      },
    };

    const noteStore: NoteQueryStore = {
      getAllNotes: () => storage.readonly('notes').getAll(),
      getNotesByIds: async (ids) => {
        const rows = await storage.readonly('notes').getMany([...ids]);
        return rows.filter((row): row is Note => row !== undefined);
      },
      getNoteIdsForTag: async (label) => {
        const ids = new Set<string>();
        for (const tag of await storage.readonly('tags').getAllFromIndex('by-label', label)) {
          for (const link of await storage.readonly('note_tags').getAllFromIndex('by-tag', tag.id)) {
            ids.add(link.noteId);
          }
        }
        return ids;
      },
      getNoteTagLabels: async (noteId) => {
        const links = await storage.readonly('note_tags').getAllFromIndex('by-note', noteId);
        const tags = await storage.readonly('tags').getMany(links.map((link) => link.tagId));
        return tags.flatMap((tag) => (tag ? [tag.label] : []));
      },
      queryDomain: async (request) => {
        const result = await storage.queryDomain({ ...request, plan: 'notes' });
        return result && result.plan === 'notes' ? result : undefined;
      },
    };

    const blockStore: BlockQueryStore = {
      getAllBlocks: () => storage.readonly('block_index').getAll(),
      queryDomain: async (request) => {
        const result = await storage.queryDomain({ ...request, plan: 'blocks' });
        return result && result.plan === 'blocks' ? result : undefined;
      },
    };

    const effortStore: EffortQueryStore = {
      getAllEfforts: () => storage.readonly('efforts').getAll(),
    };

    return {
      eventStore,
      noteStore,
      blockStore,
      effortStore,
      blockEffortsStore: {
        getAllFromIndex: (index, key) => storage.readonly('block_efforts').getAllFromIndex(index, key),
      },
      blockEquipmentStore: {
        getAllFromIndex: (index, key) => storage.readonly('block_equipment').getAllFromIndex(index, key),
      },
      tagsStore: {
        getAllFromIndex: (index, key) => storage.readonly('tags').getAllFromIndex(index, key),
        getAll: () => storage.readonly('tags').getAll(),
      },
      noteTagsStore: {
        getAllFromIndex: (index, key) => storage.readonly('note_tags').getAllFromIndex(index, key),
      },
      pageStore: {
        getNotePages: (noteId) => storage.readonly('page_notes').getAllFromIndex('by-note', noteId),
        getPage: (pageId) => storage.readonly('page').get(pageId),
        getAllPages: () => storage.readonly('page').getAll(),
        getAllLinks: () => storage.readonly('page_notes').getAll(),
      },
      relationStore: {
        getBatches: async (noteIds) => {
          const bundles = new Map<string, HarnessRelationBundle>();
          for (const noteId of noteIds) {
            const links = await storage.readonly('page_notes').getAllFromIndex('by-note', noteId);
            const tagLinks = await storage.readonly('note_tags').getAllFromIndex('by-note', noteId);
            const tags = await storage.readonly('tags').getMany(tagLinks.map((link) => link.tagId));
            const pages = await storage.readonly('page').getMany([...new Set(links.map((link) => link.pageId))]);
            bundles.set(noteId, {
              tags: tags.flatMap((tag) => (tag ? [{ label: tag.label, ...(tag.type ? { type: tag.type } : {}) }] : [])),
              links,
              pages: pages.filter((page): page is Page => page !== undefined),
            });
          }
          return bundles;
        },
      },
      feedCatalogStore: {
        getAllFeeds: async () => {
          const rows: Array<{
            id: string; label: string; url: string; tier: 'imported'; subscribed: boolean;
            installed: boolean; notebookCount: number; itemCount: number;
          }> = [];
          for (const row of await storage.readonly('meta').getAll()) {
            const key = (row as { key?: unknown }).key;
            if (typeof key !== 'string' || !key.startsWith('seed:') || key === seedMetaKey('user')) continue;
            const id = key.slice('seed:'.length);
            rows.push({
              id,
              label: id,
              url: `https://${id}.example/feed/`,
              tier: 'imported',
              subscribed: true,
              installed: true,
              notebookCount: 0,
              itemCount: 0,
            });
          }
          return rows;
        },
        getAllNotebooks: async () => {
          const links = await storage.readonly('notebook_links').getAll();
          const notes = await storage.readonly('notes').getAll();
          const memberCount = new Map<string, number>();
          for (const link of links) {
            if (link.targetKind === 'note') memberCount.set(link.notebookId, (memberCount.get(link.notebookId) ?? 0) + 1);
          }
          const rows: Array<{
            id: string; feedId: string; feedLabel: string; chunkId: string; slug: string;
            label: string; count: number; subscribed: boolean; installed: boolean;
            origin: 'user' | 'feed'; public?: boolean;
          }> = [];
          for (const [notebookId, count] of memberCount) {
            const slug = notebookId.startsWith('notebook/') ? notebookId.slice('notebook/'.length) : notebookId;
            const landing = notes.find((note) => note.id === notebookId);
            const feedSourceId = landing?.feedSourceId;
            rows.push({
              id: notebookId,
              feedId: feedSourceId ?? 'local',
              feedLabel: feedSourceId ?? 'Yours (Local)',
              chunkId: `notebook.${slug}`,
              slug,
              label: landing?.title ?? slug,
              count,
              subscribed: feedSourceId !== undefined,
              installed: true,
              origin: feedSourceId ? 'feed' : 'user',
              ...(landing?.public !== undefined ? { public: landing.public } : {}),
            });
          }
          return rows;
        },
      },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function flattenContributions(
  contributions: ReadonlyArray<{ kind?: string; type?: string; value?: unknown }> | undefined,
): { metrics: Record<string, string | number>; summaries: Record<string, string | number> } {
  const metrics: Record<string, string | number> = {};
  const summaries: Record<string, string | number> = {};
  for (const contribution of contributions ?? []) {
    if (contribution.kind !== 'metric' || typeof contribution.type !== 'string') continue;
    const value = contribution.value;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (contribution.type.startsWith('metrics.')) metrics[contribution.type.slice('metrics.'.length)] = value;
    else if (contribution.type.startsWith('summaries.')) summaries[contribution.type.slice('summaries.'.length)] = value;
  }
  return { metrics, summaries };
}

/** Store names every world-persisting write touches. */
const WORLD_STORES: StoreName[] = [
  'notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment',
  'tags', 'note_tags', 'notebook_links', 'property_overrides', 'efforts', 'equipment',
  'tag_types', 'page', 'page_notes', 'sessions', 'events',
] as const;
