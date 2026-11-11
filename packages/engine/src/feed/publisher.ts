/**
 * FeedPublisher — runtime-agnostic compiler from IStorage to any FeedTree.
 *
 * Powers both:
 *   1. Self-hosted `wod server` (`layout: 'feed'` → `/feed/*` + dirty-check status)
 *   2. Non-self-hosted Browser IndexedDB export (`layout: 'repository'` → complete
 *      `wod-wiki-feed-repository` with `markdown/notebooks/<slug>/*.md`, companion
 *      `.jsonl` for `Session.public === true`, referenced user Property Notes,
 *      GitHub Actions workflow, AND pre-compiled `dist/` Seed artifacts).
 *   3. CLI `wod publish` (replacing the incomplete `cli/publish.ts` fork).
 */

import {
  blockContentId,
  isPublishableNotebookLanding,
  notebookSlugFromId,
  parseDocumentSections,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockRevision,
  type EventRecord,
  type Note,
  type NoteBlock,
  type NoteTelemetryBundle,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { createReferenceIndex, extractStatementRefs, parseScript, type IEffort, type IEquipment, type ReferenceIndex } from '@bitcobblers/wod-wiki-lang';
import { notebookOfItem, notebookSlugOfSourceId } from '@bitcobblers/wod-wiki-wql';
import {
  EFFORTS_CHUNK_ID,
  EQUIPMENT_CHUNK_ID,
  SEED_REGISTERED_WIDGETS,
  SEED_SCHEMA,
  notebookSlugForChunkId,
  type ManifestChunk,
  type NotebookIndex,
  type NotebookIndexSummary,
  type SeedManifest,
  type SeedRecordRef,
  type SeedRow,
} from '../seed/contract';
import { seedNoteId } from '../seed/runtime';
import { assertNotebookIndex, assertSeedManifest, assertSeedRows } from '../seed/validation';
import { composeNoteMarkdown, effortToMarkdown, equipmentToMarkdown, readFrontmatterMeta } from '../exchange';
import { VERSION } from '../version';
import { renderFeedLandingHtml, type LandingNotebook } from './landing';
import {
  MemoryFeedTree,
  decodeUtf8,
  encodeUtf8,
  sha256HexAsync,
  type FeedTree,
  type FeedTreeReader,
} from './tree';

export const PUBLISHED_FEED_META_KEY = 'publish:local-feed';

export interface PublishedFeedCheckpoint {
  key: typeof PUBLISHED_FEED_META_KEY;
  version: number;
  builtAt: string;
  manifestSha256: string;
  chunkShas: Record<string, string>;
}

export interface PublishFeedOptions {
  /**
   * 'feed' writes `manifest.json`, `indexes/`, `chunks/`, `markdown/`, and `index.html`
   * directly at the tree root (used by `wod server /feed/*` and `wod publish`).
   * 'repository' writes a ready-to-push `wod-wiki-feed-repository` at the tree root
   * (`markdown/`, `package.json`, `.github/workflows/publish-feed.yml`, `README.md`)
   * AND writes the compiled static feed under `dist/`.
   */
  layout?: 'feed' | 'repository';
  /** Optional single notebook slug filter (`wod publish <slug>`). */
  notebookSlug?: string;
  /** Explicit manifest version override; defaults to monotonic checkpoint version + 1. */
  version?: number;
  /** Feed display metadata. */
  name?: string;
  description?: string;
  repositoryUrl?: string;
  /** Includeall user-owned notebooks even when `public` is not set (explicit CLI single-notebook publish). */
  includePrivateWhenFiltered?: boolean;
  /** Fixed ISO timestamp for deterministic dirty-checking. */
  builtAt?: string;
  /** Update the storage checkpoint (`publish:local-feed`) on completion (default true when layout === 'feed'). */
  recordCheckpoint?: boolean;
}

export interface PublishFeedReport {
  manifest: SeedManifest;
  notebooks: string[];
  totalNotes: number;
  totalPublicSessions: number;
  manifestSha256: string;
}

export interface UnpublishedFeedStatus {
  hasPublicContent: boolean;
  publishedVersion: number | null;
  builtAt: string | null;
  dirty: boolean;
  publicNotebooks: number;
  publicNotes: number;
  publicSessions: number;
  changes: Array<{ notebookId: string; status: 'added' | 'modified' | 'removed' }>;
}

function slugStem(raw: string, fallback: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function repoWorkflowYaml(): string {
  return `name: Publish feed

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.x
      - name: Install dependencies
        run: bun install
      - name: Build seed
        run: bunx wod build . --output dist
      - uses: actions/configure-pages@v5
      - name: Upload dist
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}

function repoPackageJson(name: string, description?: string, repositoryUrl?: string): string {
  const pkg: Record<string, unknown> = {
    name: slugStem(name, 'wod-wiki-feed'),
    version: '0.1.0',
    private: true,
    ...(description ? { description } : {}),
    ...(repositoryUrl ? { repository: { type: 'git', url: repositoryUrl } } : {}),
    scripts: {
      build: 'wod build . --output dist',
    },
    devDependencies: {
      '@bitcobblers/wod-wiki-tools': `^${VERSION}`,
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function repoReadmeMarkdown(name: string, description?: string): string {
  return `# ${name}

${description ?? 'A WOD Wiki workout feed compiled from authored Markdown notes and optional companion JSONL session logs.'}

## Layout

- \`markdown/notebooks/<slug>/*.md\` — Canonical workout & note Markdown with YAML frontmatter.
- \`markdown/notebooks/<slug>/*.jsonl\` — Optional companion Session, BlockRevision, and EventRecord telemetry (present only for Sessions explicitly marked public).
- \`dist/\` — Pre-compiled static Seed artifacts (\`manifest.json\`, \`indexes/\`, \`chunks/\`, \`index.html\`), ready for static hosting or rebuilt on push via GitHub Actions.
`;
}

async function compileSeedRowForNote(params: {
  notePath: string;
  content: string;
  title: string;
  createdAt: number;
  routeId?: string;
  sourceId?: string;
  publicSessions: Session[];
  eventsBySession: ReadonlyMap<string, EventRecord[]>;
  revisionsByKey: ReadonlyMap<string, BlockRevision>;
  referenceIndex: ReferenceIndex;
}): Promise<{ row: SeedRow; uuid: string; companionBundle?: NoteTelemetryBundle }> {
  const {
    notePath,
    content,
    title,
    createdAt,
    routeId,
    sourceId,
    publicSessions,
    eventsBySession,
    revisionsByKey,
    referenceIndex,
  } = params;

  const uuid = await seedNoteId(notePath);
  let ordinal = 0;
  const blocks: Record<string, NoteBlock> = reconcileNoteBlocks(content, {
    sourceRevision: 1,
    registeredWidgets: SEED_REGISTERED_WIDGETS,
    createId: () => `seed:${notePath}:${ordinal++}`,
  });

  const sections = parseDocumentSections(content, { registeredWidgets: SEED_REGISTERED_WIDGETS });
  const blockIndex: BlockIndexRow[] = Object.values(blocks).map((block, position) => {
    const section = sections.find((s) => s.from === block.from && s.to === block.to);
    const fingerprint =
      block.kind === 'wod'
        ? blockContentId(section?.scriptBlock?.content ?? content.slice(block.from, block.to))
        : undefined;
    return {
      id: `${uuid}:${block.id}`,
      noteId: uuid,
      blockId: block.id,
      blockVersion: 1,
      sourceRevision: 1,
      from: block.from,
      to: block.to,
      position,
      dataType: block.kind,
      ...(fingerprint ? { blockContentId: fingerprint } : {}),
      rawContent: content.slice(block.from, block.to),
      noteTitle: title,
      createdAt,
      isStatic: true,
      ...(sourceId ? { sourceId } : {}),
      sourcePath: notePath,
      ...(routeId ? { routeId } : {}),
    };
  });

  const blockEfforts: BlockEffort[] = [];
  const blockEquipment: BlockEquipment[] = [];

  for (const proj of blockIndex) {
    if (proj.dataType !== 'wod' || !proj.rawContent) continue;
    const sec = parseDocumentSections(proj.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS }).find(
      (s) => s.scriptBlock,
    );
    const parsed = parseScript(sec?.scriptBlock?.content ?? proj.rawContent, { references: referenceIndex });
    const refs = extractStatementRefs(parsed.statements);

    const seenEfforts = new Set<string>();
    for (const rawSlug of refs.efforts) {
      const canonical = referenceIndex.resolveEffort(rawSlug)?.slug;
      if (!canonical || seenEfforts.has(canonical)) continue;
      seenEfforts.add(canonical);
      blockEfforts.push({
        id: `${proj.id}:${canonical}`,
        noteId: uuid,
        blockId: proj.blockId,
        blockContentId: proj.blockContentId,
        effortSlug: canonical,
        isStatic: true,
        sourcePath: notePath,
        createdAt,
      });
    }

    const seenEquipment = new Set<string>();
    for (const rawSlug of refs.equipment) {
      const canonical = referenceIndex.resolveEquipment(rawSlug)?.slug;
      if (!canonical || seenEquipment.has(canonical)) continue;
      seenEquipment.add(canonical);
      blockEquipment.push({
        id: `${proj.id}:${canonical}`,
        noteId: uuid,
        blockId: proj.blockId,
        blockContentId: proj.blockContentId,
        equipmentSlug: canonical,
        isStatic: true,
        sourcePath: notePath,
        createdAt,
      });
    }
  }

  const wodProjections = blockIndex.filter((b) => b.dataType === 'wod');
  const remappedSessions: Session[] = [];
  const remappedEvents: EventRecord[] = [];
  const remappedRevisions: BlockRevision[] = [];
  const seenRevKeys = new Set<string>();

  for (const s of publicSessions) {
    const matchedProj =
      wodProjections.find((p) => p.blockContentId && p.blockContentId === s.blockContentId) ??
      wodProjections[0];
    if (!matchedProj || !matchedProj.blockContentId) continue;

    const mappedSession: Session = {
      ...s,
      noteId: uuid,
      blockId: matchedProj.blockId,
      blockVersion: 1,
      blockContentId: matchedProj.blockContentId,
      public: true,
    };
    remappedSessions.push(mappedSession);

    const revKey = `${s.noteId}\u0000${s.blockId}\u0000${s.blockVersion}`;
    const origRev = revisionsByKey.get(revKey);
    const targetRevKey = `${uuid}\u0000${matchedProj.blockId}\u00001`;
    if (!seenRevKeys.has(targetRevKey)) {
      seenRevKeys.add(targetRevKey);
      remappedRevisions.push({
        noteId: uuid,
        blockId: matchedProj.blockId,
        version: 1,
        kind: 'wod',
        rawContent: matchedProj.rawContent,
        savedAt: origRev?.savedAt ?? s.createdAt,
        dialect: blocks[matchedProj.blockId]?.dialect ?? origRev?.dialect ?? 'time',
        ...(blocks[matchedProj.blockId]?.sport ? { sport: blocks[matchedProj.blockId]!.sport } : {}),
      });
    }

    for (const ev of eventsBySession.get(s.id) ?? []) {
      remappedEvents.push({
        ...ev,
        noteId: uuid,
        blockId: matchedProj.blockId,
        blockVersion: 1,
        blockContentId: matchedProj.blockContentId,
      });
    }
  }

  const telemetry =
    remappedSessions.length > 0
      ? { sessions: remappedSessions, events: remappedEvents }
      : undefined;

  const companionBundle: NoteTelemetryBundle | undefined =
    remappedSessions.length > 0
      ? {
          revisions: remappedRevisions,
          sessions: remappedSessions,
          events: remappedEvents,
        }
      : undefined;

  const row: SeedRow = {
    path: notePath,
    content,
    blocks,
    blockIndex,
    blockEfforts,
    blockEquipment,
    uuid,
    commit: '',
    version: 1,
    ...(telemetry ? { telemetry } : {}),
  };

  return { row, uuid, companionBundle };
}

interface CollectedPublicData {
  notebooks: Map<string, { landing?: Note; label: string; description?: string; notes: Note[] }>;
  publicSessionsByNote: Map<string, Session[]>;
  eventsBySession: Map<string, EventRecord[]>;
  revisionsByKey: Map<string, BlockRevision>;
  efforts: IEffort[];
  equipment: IEquipment[];
  notesById: Map<string, Note>;
  storedCheckpoint?: PublishedFeedCheckpoint;
}

async function collectPublicStorageState(
  storage: IStorage,
  options: PublishFeedOptions = {},
): Promise<CollectedPublicData> {
  const [allNotes, allSessions, allEvents, allRevisions, efforts, equipment, storedMeta] = await Promise.all([
    storage.readonly('notes').getAll(),
    storage.readonly('sessions').getAll(),
    storage.readonly('events').getAll(),
    storage.readonly('block_revisions').getAll(),
    storage.readonly('efforts').getAll(),
    storage.readonly('equipment').getAll(),
    storage.readonly('meta').get(PUBLISHED_FEED_META_KEY),
  ]);

  const notesById = new Map(allNotes.map((n) => [n.id, n]));
  const landingsBySlug = new Map<string, Note>();
  for (const n of allNotes) {
    if (n.id.startsWith('notebook/') && n.notebookId === n.id && n.feedOrigin !== 'feed' && n.seedOrigin !== 'seed') {
      landingsBySlug.set(notebookSlugFromId(n.id), n);
    }
  }

  const filterSlug = options.notebookSlug ? notebookSlugFromId(options.notebookSlug) : undefined;
  const notebooks = new Map<string, { landing?: Note; label: string; description?: string; notes: Note[] }>();

  for (const [slug, landing] of landingsBySlug.entries()) {
    if (filterSlug && slug !== filterSlug) continue;
    const isPublic = landing.public === true || (filterSlug === slug && options.includePrivateWhenFiltered === true);
    if (!isPublic) continue;
    const fm = readFrontmatterMeta(landing.rawContent);
    const desc = typeof fm['description'] === 'string' ? fm['description'].replace(/^"|"$/g, '') : undefined;
    notebooks.set(slug, {
      landing,
      label: landing.title || slug,
      description: desc,
      notes: [],
    });
  }

  for (const note of allNotes) {
    if (note.id.startsWith('notebook/') && note.notebookId === note.id) continue;
    if (note.feedOrigin === 'feed' || note.seedOrigin === 'seed') {
      // Allow explicit CLI single-notebook publish of an imported notebook only when includePrivateWhenFiltered is set
      if (!filterSlug || !options.includePrivateWhenFiltered) continue;
    }
    const noteFm = readFrontmatterMeta(note.rawContent);
    const fmNotebook =
      (typeof noteFm['notebook'] === 'string' ? noteFm['notebook'] : undefined) ??
      (typeof noteFm['catalog'] === 'string' ? noteFm['catalog'] : undefined);
    const resolvedNbId =
      note.notebookId ??
      (fmNotebook ? `notebook/${notebookSlugFromId(fmNotebook)}` : undefined) ??
      (notebookOfItem(note) ??
        (note.sourceId
          ? notebookSlugOfSourceId(note.sourceId)
            ? `notebook/${notebookSlugOfSourceId(note.sourceId)}`
            : undefined
          : undefined));
    if (!resolvedNbId) continue;
    const slug = notebookSlugFromId(resolvedNbId);
    if (filterSlug && slug !== filterSlug) continue;

    let group = notebooks.get(slug);
    if (!group && options.includePrivateWhenFiltered) {
      group = { label: slug, notes: [] };
      notebooks.set(slug, group);
    }
    if (!group) continue;
    if (isPublishableNotebookLanding(note)) continue;
    group.notes.push(note);
  }

  // Sort member notes deterministically by path/id so sha256 is stable
  for (const group of notebooks.values()) {
    group.notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const publicSessionsByNote = new Map<string, Session[]>();
  const includedSessionIds = new Set<string>();
  for (const s of allSessions) {
    if (s.public !== true) continue;
    const list = publicSessionsByNote.get(s.noteId) ?? [];
    list.push(s);
    publicSessionsByNote.set(s.noteId, list);
    includedSessionIds.add(s.id);
  }
  for (const list of publicSessionsByNote.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const eventsBySession = new Map<string, EventRecord[]>();
  for (const ev of allEvents) {
    if (!includedSessionIds.has(ev.resultId)) continue;
    const list = eventsBySession.get(ev.resultId) ?? [];
    list.push(ev);
    eventsBySession.set(ev.resultId, list);
  }
  for (const list of eventsBySession.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const revisionsByKey = new Map<string, BlockRevision>();
  for (const rev of allRevisions) {
    revisionsByKey.set(`${rev.noteId}\u0000${rev.blockId}\u0000${rev.version}`, rev);
  }

  const isCheckpoint = (v: unknown): v is PublishedFeedCheckpoint =>
    typeof v === 'object' && v !== null && 'key' in v && v.key === PUBLISHED_FEED_META_KEY;
  const storedCheckpoint = isCheckpoint(storedMeta) ? storedMeta : undefined;

  return {
    notebooks,
    publicSessionsByNote,
    eventsBySession,
    revisionsByKey,
    efforts,
    equipment,
    notesById,
    storedCheckpoint,
  };
}

export async function publishFeedFromStorage(
  storage: IStorage,
  tree: FeedTree,
  options: PublishFeedOptions = {},
): Promise<PublishFeedReport> {
  const t0 = Date.now();
  const layout = options.layout ?? 'feed';
  const state = await collectPublicStorageState(storage, options);

  if (state.notebooks.size === 0) {
    throw new Error('No public notebooks found to publish. Mark at least one user-owned notebook as Public first.');
  }

  const referenceIndex = createReferenceIndex({
    efforts: state.efforts,
    equipment: state.equipment,
  });

  const nextVersion = options.version ?? ((state.storedCheckpoint?.version ?? 0) + 1);
  const builtAt = options.builtAt ?? new Date().toISOString();
  const artifactPrefix = layout === 'repository' ? 'dist/' : '';

  const manifestChunks: ManifestChunk[] = [];
  const manifestNotebooks: NotebookIndexSummary[] = [];
  const landingNotebooks: LandingNotebook[] = [];
  const referencedUserEfforts = new Set<string>();
  const referencedUserEquipment = new Set<string>();

  let totalNotes = 0;
  let totalPublicSessions = 0;

  const sortedSlugs = [...state.notebooks.keys()].sort();

  for (const notebookSlug of sortedSlugs) {
    const group = state.notebooks.get(notebookSlug)!;
    const chunkId = `notebook.${notebookSlug}`;
    const usedStems = new Set<string>();
    const rows: SeedRow[] = [];
    const records: SeedRecordRef[] = [];
    const landingNotes: LandingNotebook['notes'] = [];

    if (layout === 'repository') {
      const readmeMd = group.landing
        ? group.landing.rawContent
        : `# ${group.label}\n\n${group.description ?? ''}\n`;
      await tree.write(`markdown/notebooks/${notebookSlug}/README.md`, encodeUtf8(readmeMd));
    }

    for (const note of group.notes) {
      let baseStem = slugStem(note.title || note.id, 'note');
      if (baseStem.toLowerCase() === 'readme') baseStem = 'note-readme';
      let stem = baseStem;
      let suffix = 2;
      while (usedStems.has(stem)) {
        stem = `${baseStem}-${suffix++}`;
      }
      usedStems.add(stem);

      const notePath = `markdown/notebooks/${notebookSlug}/${stem}.md`;
      const portableMd = composeNoteMarkdown({
        ...note,
        notebookId: `notebook/${notebookSlug}`,
      });
      // SeedRow stores the clean authored content (or portableMd when exporting repo)
      const contentForSeed = layout === 'repository' ? portableMd : note.rawContent;
      const publicSessions = state.publicSessionsByNote.get(note.id) ?? [];
      totalPublicSessions += publicSessions.length;

      const { row, uuid, companionBundle } = await compileSeedRowForNote({
        notePath,
        content: contentForSeed,
        title: note.title || stem,
        createdAt: note.date ?? note.createdAt,
        routeId: `${notebookSlug}/${stem}`,
        sourceId: `notebook:${notebookSlug}/${stem}`,
        publicSessions,
        eventsBySession: state.eventsBySession,
        revisionsByKey: state.revisionsByKey,
        referenceIndex,
      });

      for (const eff of row.blockEfforts) referencedUserEfforts.add(eff.effortSlug);
      for (const eq of row.blockEquipment) referencedUserEquipment.add(eq.equipmentSlug);

      rows.push(row);

      // Write source .md and optional .jsonl at root (and inside dist/ for compiled records)
      await tree.write(notePath, encodeUtf8(portableMd));
      const recordRelPath = notePath.replace(/\.md$/, '.json');
      const recordBytes = encodeUtf8(JSON.stringify(row, null, 2));
      await tree.write(`${artifactPrefix}${recordRelPath}`, recordBytes);

      if (companionBundle) {
        const jsonlText = serializeNoteBundleToJsonl(companionBundle) + '\n';
        await tree.write(notePath.replace(/\.md$/, '.jsonl'), encodeUtf8(jsonlText));
        if (artifactPrefix) {
          await tree.write(`${artifactPrefix}${notePath.replace(/\.md$/, '.jsonl')}`, encodeUtf8(jsonlText));
        }
      }

      records.push({
        uuid,
        path: notePath,
        recordPath: recordRelPath,
        commit: '',
        version: note.sourceRevision ?? 1,
        sha256: await sha256HexAsync(recordBytes),
        title: note.title || stem,
        ...(note.date !== undefined ? { date: note.date } : {}),
      });

      landingNotes.push({
        title: note.title || stem,
        path: notePath,
        date: note.date,
        recordPath: recordRelPath,
        content: note.rawContent,
        publicSessions: publicSessions.length,
      });
    }

    assertSeedRows(rows);
    const chunkBytes = encodeUtf8(JSON.stringify(rows));
    const chunkSha = await sha256HexAsync(chunkBytes);
    const chunkRelPath = `chunks/${chunkId}.${chunkSha.slice(0, 8)}.json`;
    await tree.write(`${artifactPrefix}${chunkRelPath}`, chunkBytes);

    manifestChunks.push({
      id: chunkId,
      path: chunkRelPath,
      sha256: chunkSha,
      bytes: chunkBytes.byteLength,
      count: rows.length,
      kind: 'notes',
    });
    totalNotes += rows.length;

    const indexPath = `indexes/notebooks/${chunkId}.json`;
    const summary: NotebookIndexSummary = {
      notebookId: chunkId,
      label: group.label,
      category: notebookSlugForChunkId(chunkId),
      indexPath,
      version: nextVersion,
      commit: '',
      updatedAt: builtAt,
      builtAt,
      sha256: chunkSha,
      bytes: chunkBytes.byteLength,
      count: rows.length,
    };
    const notebookIndex: NotebookIndex = {
      ...summary,
      records,
    };
    assertNotebookIndex(notebookIndex);
    await tree.write(`${artifactPrefix}${indexPath}`, encodeUtf8(JSON.stringify(notebookIndex, null, 2) + '\n'));
    manifestNotebooks.push(summary);
    landingNotebooks.push({
      id: chunkId,
      label: group.label,
      notes: landingNotes,
    });
  }

  // Emit referenced user-authored Effort and Equipment Property Notes
  const userEfforts = state.efforts.filter(
    (e) => e.registrySource !== 'bundled' && referencedUserEfforts.has(e.slug),
  );
  if (userEfforts.length > 0) {
    const effortRows: SeedRow[] = [];
    for (const eff of userEfforts.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      const owner = eff.ownerNoteId ? state.notesById.get(eff.ownerNoteId) : undefined;
      const md = owner?.rawContent ?? effortToMarkdown(eff);
      const effPath = `markdown/efforts/${eff.slug}.md`;
      await tree.write(effPath, encodeUtf8(md));
      const { row } = await compileSeedRowForNote({
        notePath: effPath,
        content: md,
        title: eff.label,
        createdAt: 0,
        sourceId: 'efforts',
        publicSessions: [],
        eventsBySession: state.eventsBySession,
        revisionsByKey: state.revisionsByKey,
        referenceIndex,
      });
      effortRows.push(row);
    }
    assertSeedRows(effortRows);
    const bytes = encodeUtf8(JSON.stringify(effortRows));
    const sha = await sha256HexAsync(bytes);
    const rel = `chunks/${EFFORTS_CHUNK_ID}.${sha.slice(0, 8)}.json`;
    await tree.write(`${artifactPrefix}${rel}`, bytes);
    manifestChunks.push({ id: EFFORTS_CHUNK_ID, path: rel, sha256: sha, bytes: bytes.byteLength, count: effortRows.length });
  }

  const userEquipment = state.equipment.filter(
    (eq) => eq.registrySource !== 'bundled' && referencedUserEquipment.has(eq.slug),
  );
  if (userEquipment.length > 0) {
    const eqRows: SeedRow[] = [];
    for (const eq of userEquipment.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      const owner = eq.ownerNoteId ? state.notesById.get(eq.ownerNoteId) : undefined;
      const md = owner?.rawContent ?? equipmentToMarkdown(eq);
      const eqPath = `markdown/equipment/${eq.slug}.md`;
      await tree.write(eqPath, encodeUtf8(md));
      const { row } = await compileSeedRowForNote({
        notePath: eqPath,
        content: md,
        title: eq.label,
        createdAt: 0,
        sourceId: 'equipment',
        publicSessions: [],
        eventsBySession: state.eventsBySession,
        revisionsByKey: state.revisionsByKey,
        referenceIndex,
      });
      eqRows.push(row);
    }
    assertSeedRows(eqRows);
    const bytes = encodeUtf8(JSON.stringify(eqRows));
    const sha = await sha256HexAsync(bytes);
    const rel = `chunks/${EQUIPMENT_CHUNK_ID}.${sha.slice(0, 8)}.json`;
    await tree.write(`${artifactPrefix}${rel}`, bytes);
    manifestChunks.push({ id: EQUIPMENT_CHUNK_ID, path: rel, sha256: sha, bytes: bytes.byteLength, count: eqRows.length });
  }

  const safeRepoUrl =
    options.repositoryUrl && /^https:\/\//.test(options.repositoryUrl)
      ? options.repositoryUrl
      : undefined;

  const feedName = options.name ?? 'My Published Feed';
  const manifest: SeedManifest = {
    name: feedName,
    ...(options.description ? { description: options.description } : {}),
    ...(safeRepoUrl ? { repositoryUrl: safeRepoUrl } : {}),
    schema: SEED_SCHEMA,
    version: nextVersion,
    versionLabel: `v${nextVersion}`,
    commit: '',
    builtAt,
    chunks: manifestChunks,
    notebooks: manifestNotebooks,
  };
  assertSeedManifest(manifest);

  const totalMs = Math.max(1, Date.now() - t0);
  const landingHtml = renderFeedLandingHtml({
    manifest,
    totalMs,
    passMs: { scan: 0, blockIndex: 0, parseGate: 0, blockEfforts: 0, write: totalMs },
    fileCount: totalNotes,
    notebooks: landingNotebooks,
  });
  await tree.write(`${artifactPrefix}index.html`, encodeUtf8(landingHtml));

  if (layout === 'repository') {
    if (!(await tree.stat('package.json'))) {
      await tree.write('package.json', encodeUtf8(repoPackageJson(feedName, options.description, safeRepoUrl)));
    }
    if (!(await tree.stat('.github/workflows/publish-feed.yml'))) {
      await tree.write('.github/workflows/publish-feed.yml', encodeUtf8(repoWorkflowYaml()));
    }
    if (!(await tree.stat('README.md'))) {
      await tree.write('README.md', encodeUtf8(repoReadmeMarkdown(feedName, options.description)));
    }
  }

  // Manifest-last commit ordering: readers always see complete chunks/indexes once manifest.json lands.
  const manifestBytes = encodeUtf8(JSON.stringify(manifest, null, 2) + '\n');
  const manifestSha256 = await sha256HexAsync(manifestBytes);
  await tree.write(`${artifactPrefix}manifest.json`, manifestBytes);

  const shouldCheckpoint = options.recordCheckpoint ?? (layout === 'feed' && !options.notebookSlug);
  if (shouldCheckpoint) {
    const chunkShas: Record<string, string> = {};
    for (const c of manifestChunks) chunkShas[c.id] = c.sha256;
    const cp: PublishedFeedCheckpoint = {
      key: PUBLISHED_FEED_META_KEY,
      version: nextVersion,
      builtAt,
      manifestSha256,
      chunkShas,
    };
    await storage.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put(cp);
    });
  }

  return {
    manifest,
    notebooks: sortedSlugs,
    totalNotes,
    totalPublicSessions,
    manifestSha256,
  };
}

/**
 * Compare current public Notebooks & public Sessions in `storage` against the last
 * published snapshot (`currentTree` or stored `publish:local-feed` checkpoint)
 * to surface "Unpublished changes" without mutating storage.
 */
export async function checkUnpublishedFeedChanges(
  storage: IStorage,
  currentTree?: FeedTreeReader,
  options: PublishFeedOptions = {},
): Promise<UnpublishedFeedStatus> {
  const state = await collectPublicStorageState(storage, options);
  const publicNotebooks = state.notebooks.size;
  let publicNotes = 0;
  let publicSessions = 0;
  for (const nb of state.notebooks.values()) {
    publicNotes += nb.notes.length;
    for (const n of nb.notes) {
      publicSessions += (state.publicSessionsByNote.get(n.id) ?? []).length;
    }
  }

  let priorChunkShas: Record<string, string> | undefined = state.storedCheckpoint?.chunkShas;
  let publishedVersion: number | null = state.storedCheckpoint?.version ?? null;
  let builtAt: string | null = state.storedCheckpoint?.builtAt ?? null;

  if (currentTree) {
    try {
      const raw = decodeUtf8(await currentTree.read('manifest.json'));
      const parsed = assertSeedManifest(JSON.parse(raw));
      publishedVersion = parsed.version;
      builtAt = parsed.builtAt;
      priorChunkShas = {};
      for (const c of parsed.chunks) priorChunkShas[c.id] = c.sha256;
    } catch {
      // No live manifest in tree yet
    }
  }

  if (publicNotebooks === 0) {
    const hadPrior = priorChunkShas !== undefined && Object.keys(priorChunkShas).length > 0;
    return {
      hasPublicContent: false,
      publishedVersion,
      builtAt,
      dirty: hadPrior,
      publicNotebooks: 0,
      publicNotes: 0,
      publicSessions: 0,
      changes: hadPrior
        ? Object.keys(priorChunkShas!).map((id) => ({ notebookId: id, status: 'removed' as const }))
        : [],
    };
  }

  const scratch = new MemoryFeedTree();
  const compiled = await publishFeedFromStorage(storage, scratch, {
    ...options,
    layout: 'feed',
    version: publishedVersion ?? 1,
    builtAt: builtAt ?? '1970-01-01T00:00:00.000Z',
    recordCheckpoint: false,
  });

  if (!priorChunkShas) {
    return {
      hasPublicContent: true,
      publishedVersion: null,
      builtAt: null,
      dirty: true,
      publicNotebooks,
      publicNotes,
      publicSessions,
      changes: compiled.manifest.chunks.map((c) => ({ notebookId: c.id, status: 'added' as const })),
    };
  }

  const changes: Array<{ notebookId: string; status: 'added' | 'modified' | 'removed' }> = [];
  const nextIds = new Set<string>();
  for (const c of compiled.manifest.chunks) {
    nextIds.add(c.id);
    if (!(c.id in priorChunkShas)) {
      changes.push({ notebookId: c.id, status: 'added' });
    } else if (priorChunkShas[c.id] !== c.sha256) {
      changes.push({ notebookId: c.id, status: 'modified' });
    }
  }
  for (const oldId of Object.keys(priorChunkShas)) {
    if (!nextIds.has(oldId)) {
      changes.push({ notebookId: oldId, status: 'removed' });
    }
  }

  return {
    hasPublicContent: true,
    publishedVersion,
    builtAt,
    dirty: changes.length > 0,
    publicNotebooks,
    publicNotes,
    publicSessions,
    changes,
  };
}
