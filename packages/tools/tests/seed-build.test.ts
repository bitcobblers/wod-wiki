/**
 * seed-build tests — parity + determinism + dashboard-gate guards for the
 * seed compiler behind `wod build`.
 *
 * The parity gate (unknown corpus → hard error) is the load-bearing check
 * wired into the build; these tests pin its contract with fixture corpora:
 * partition rules, chunk byte determinism, manifest shape, effort discovery
 * and scaffolding, alias resolution, and the #906 dashboard format gate.
 *
 * The content repo (wod-wiki-community) additionally validates its real
 * corpus on every MR through `wod build` itself.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildBlockEffortRows,
  buildBlockIndexRows,
  compileSeedRow,
  chunkIdFor,
  collectCorpusMarkdown,
  discoverUncatalogedEfforts,
  generateSeed,
  partitionIntoChunks,
  scaffoldDiscoveredEfforts,
  validateDashboardNote,
  validateWodBlockSyntax,
} from '../src/seedbuild/compiler';
import { SEED_SCHEMA, catalogForChunkId, canvasRouteSlug, seedNoteSourceId } from '../src/seedbuild/contract';
import { catalogOfItem, notebookOfItem } from '@bitcobblers/wod-wiki-wql';
import { cliMain } from '../src/index';

const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

describe('chunkIdFor partition rules', () => {
  it('maps each corpus to its chunk id', () => {
    expect(chunkIdFor('markdown/canvas/syntax/x.md')).toBe('canvas');
    expect(chunkIdFor('markdown/dashboards/a.md')).toBe('dashboards');
    expect(chunkIdFor('markdown/efforts/e.md')).toBe('efforts');
    expect(chunkIdFor('markdown/collections/girls/fran.md')).toBe('collection.girls');
    expect(chunkIdFor('markdown/feeds/programming/2026-01.md')).toBe('feed.programming');
  });

  it('routes top-level collection/feed files to the _root chunk', () => {
    expect(chunkIdFor('markdown/collections/README.md')).toBe('collection._root');
    expect(chunkIdFor('markdown/feeds/README.md')).toBe('feed._root');
  });

  it('rejects unknown corpora, bare markdown files, and non-markdown trees', () => {
    expect(chunkIdFor('markdown/weird/x.md')).toBeNull();
    expect(chunkIdFor('markdown/README.md')).toBeNull();
    expect(chunkIdFor('apps/playground/x.md')).toBeNull();
  });
});

describe('partitionIntoChunks', () => {
  it('throws on files outside the known corpora (the parity gate)', () => {
    expect(() => partitionIntoChunks(['markdown/canvas/a.md', 'markdown/newcorpus/b.md']))
      .toThrow(/Parity failure.*markdown\/newcorpus\/b\.md/);
  });

  it('partitions a fixture corpus completely — no file dropped or duplicated', () => {
    const tmp = makeTmpCorpus();
    try {
      const files = collectCorpusMarkdown(join(tmp, 'markdown'));
      expect(files.length).toBeGreaterThan(0);
      const groups = partitionIntoChunks(files);
      const grouped = groups.flatMap((g) => g.files);
      expect(grouped).toHaveLength(files.length);
      expect(new Set(grouped).size).toBe(files.length);
      for (const f of files) expect(grouped).toContain(f);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('generateSeed', () => {
  it('publishes catalog identity and a safe source link from package metadata', () => {
    const tmp = makeTmpCorpus();
    try {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'Coach programming', description: 'Daily sessions', repository: { url: 'git+https://github.com/example/programming.git' } }));
      const { manifest } = generateSeed({ corpusRoot: tmp, outDir: join(tmp, 'out'), version: 1 });
      expect(manifest.name).toBe('Coach programming');
      expect(manifest.description).toBe('Daily sessions');
      expect(manifest.repositoryUrl).toBe('https://github.com/example/programming');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ repository: 'git@github.com:example/programming.git' }));
      expect(generateSeed({ corpusRoot: tmp, outDir: join(tmp, 'out'), version: 1 }).manifest.repositoryUrl).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('emits manifest + content-hashed chunks matching the corpus', () => {
    const tmp = makeTmpCorpus();
    try {
      const { manifest, outDir } = generateSeed({
        markdownDir: join(tmp, 'markdown'),
        templateFile: join(tmp, 'template.md'),
        outDir: join(tmp, 'out'),
        corpusRoot: tmp,
        version: 12345,
      });

      expect(manifest.schema).toBe(SEED_SCHEMA);
      expect(manifest.version).toBe(12345);
      expect(manifest.chunks.map((c) => c.id)).toEqual([
        'canvas', 'collection.cat1', 'feed.f', 'template',
      ]);

      for (const c of manifest.chunks) {
        const bytes = readFileSync(join(outDir, c.path));
        expect(existsSync(join(outDir, c.path))).toBe(true);
        expect(c.path).toMatch(new RegExp(`^chunks/${c.id}\\.[0-9a-f]{8}\\.json$`));
        expect(c.path).toContain(c.sha256.slice(0, 8));
        expect(c.sha256).toBe(sha256(bytes));
        const rows = JSON.parse(bytes.toString('utf8')) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(c.count);
        for (const row of rows) {
          expect(row.content).toBe(readFileSync(join(tmp, row.path as string), 'utf8'));
        }
      }

      // The HTML build report ships alongside the artifacts.
      expect(existsSync(join(outDir, 'report.html'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('excludes host-owned markdown from both chunk rows and the derived block index', () => {
    const tmp = makeTmpCorpus();
    writeFileSync(join(tmp, 'markdown/canvas/a.md'), '```time\n5 Situps\n```');
    writeFileSync(join(tmp, 'markdown/canvas/sub/b.md'), '```time\n10 Pushups\n```');
    try {
      const markdownDir = join(tmp, 'markdown');
      const excludePaths = ['markdown/canvas/a.md'];
      const { manifest, outDir } = generateSeed({
        markdownDir,
        corpusRoot: tmp,
        outDir: join(tmp, 'out'),
        version: 1,
        excludePaths,
      });
      const canvasRef = manifest.chunks.find((chunk) => chunk.id === 'canvas');
      if (!canvasRef) throw new Error('canvas chunk missing');
      const rows = JSON.parse(readFileSync(join(outDir, canvasRef.path), 'utf8')) as Array<{ path: string }>;
      expect(rows.map((row) => row.path)).toEqual(['markdown/canvas/sub/b.md']);

      const blockRows = buildBlockIndexRows(markdownDir, tmp, excludePaths);
      expect(blockRows.map((row) => row.sourcePath)).toContain('markdown/canvas/sub/b.md');
      expect(blockRows.map((row) => row.sourcePath)).not.toContain('markdown/canvas/a.md');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is deterministic: identical corpus → identical chunk bytes, only version advances', () => {
    const tmp = makeTmpCorpus();
    try {
      const opts = {
        markdownDir: join(tmp, 'markdown'),
        templateFile: join(tmp, 'template.md'),
        outDir: join(tmp, 'out'),
        corpusRoot: tmp,
      };
      const first = generateSeed({ ...opts, version: 1000 });
      const second = generateSeed({ ...opts, version: 2000 });

      expect(second.manifest.chunks.map((c) => c.path))
        .toEqual(first.manifest.chunks.map((c) => c.path));
      expect(second.manifest.chunks.map((c) => c.sha256))
        .toEqual(first.manifest.chunks.map((c) => c.sha256));
      expect(second.manifest.version).toBe(2000);
      // Manifest bytes differ ONLY through version/builtAt.
      expect(JSON.stringify(second.manifest.chunks))
        .toBe(JSON.stringify(first.manifest.chunks));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('emits notebook indexes and individual compiled record JSONs alongside markdown', () => {
    const tmp = makeTmpCorpus();
    try {
      const outDir = join(tmp, 'out');
      const { manifest } = generateSeed({
        markdownDir: join(tmp, 'markdown'),
        outDir,
        corpusRoot: tmp,
        version: 1,
      });

      expect(manifest.notebooks).toBeDefined();
      expect(manifest.notebooks!.length).toBeGreaterThan(0);

      const cat1Nb = manifest.notebooks!.find((n) => n.notebookId === 'collection.cat1');
      expect(cat1Nb).toBeDefined();
      expect(cat1Nb!.count).toBe(1);
      expect(cat1Nb!.records.length).toBe(1);

      const recordRef = cat1Nb!.records[0];
      expect(recordRef.path).toBe('markdown/collections/cat1/c.md');
      expect(recordRef.recordPath).toBe('markdown/collections/cat1/c.json');
      expect(recordRef.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(recordRef.sha256).toMatch(/^[0-9a-f]{64}$/);

      // Verify individual record JSON was written alongside the markdown in outDir
      const recordJsonPath = join(outDir, recordRef.recordPath);
      expect(existsSync(recordJsonPath)).toBe(true);
      const parsedRecord = JSON.parse(readFileSync(recordJsonPath, 'utf8'));
      expect(parsedRecord.path).toBe('markdown/collections/cat1/c.md');
      expect(parsedRecord.content).toBe('# C');
      expect(parsedRecord.uuid).toBe(recordRef.uuid);

      // Verify individual notebook index was written in outDir
      expect(cat1Nb!.indexPath).toBe('indexes/notebooks/collection.cat1.json');
      const indexJsonPath = join(outDir, cat1Nb!.indexPath!);
      expect(existsSync(indexJsonPath)).toBe(true);
      const parsedIndex = JSON.parse(readFileSync(indexJsonPath, 'utf8'));
      expect(parsedIndex.notebookId).toBe('collection.cat1');
      expect(parsedIndex.records.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('sparse seed occurrences', () => {
  it('preserves exact UTF-16 slices and deterministic distinct duplicates', () => {
    const source = '# 🏋️\r\n\r\n```time\r\n10 Push-ups\r\n```\r\n\r\n```time\r\n10 Push-ups\r\n```\r\n';
    const a = compileSeedRow('markdown/collections/test/a.md', source);
    const b = compileSeedRow(a.path, source);
    expect(a).toEqual(b);
    expect(Object.keys(a.blocks)).toHaveLength(2);
    expect(a.blockIndex.map((r) => r.dataType)).toEqual(['wod', 'wod']);
    for (const row of a.blockIndex) expect(row.rawContent).toBe(source.slice(row.from, row.to));
    expect(a.blockIndex[0].blockId).not.toBe(a.blockIndex[1].blockId);
    expect(a.blockIndex[0].blockContentId).toBe(a.blockIndex[1].blockContentId);
  });
});

describe('dashboard gate (#906)', () => {
  it('accepts a well-formed dashboard note (the locked #899 format)', () => {
    expect(validateDashboardNote(VALID_DASHBOARD)).toEqual([]);
  });

  it('rejects invalid dashboards and fails the build (WQL parse error, undeclared token)', () => {
    expect(validateDashboardNote(BAD_WQL_DASHBOARD.join('\n')).length).toBeGreaterThan(0);
    expect(validateDashboardNote(UNDEFINED_TOKEN_DASHBOARD.join('\n')).length).toBeGreaterThan(0);

    const tmp = mkdtempSync(join(tmpdir(), 'seed-dashboard-gate-'));
    try {
      mkdirSync(join(tmp, 'markdown/dashboards'), { recursive: true });
      writeFileSync(join(tmp, 'markdown/dashboards/bad.md'), BAD_WQL_DASHBOARD.join('\n'), 'utf8');
      expect(() => generateSeed({
        markdownDir: join(tmp, 'markdown'),
        outDir: join(tmp, 'out'),
        corpusRoot: tmp,
        version: 1,
      })).toThrow(/Dashboard validation failed for 'markdown\/dashboards\/bad\.md'/);
      expect(existsSync(join(tmp, 'out'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('block syntax gate', () => {
  function makeCorpus(script: string): string {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-syntax-gate-'));
    mkdirSync(join(tmp, 'markdown/collections/workout'), { recursive: true });
    writeFileSync(
      join(tmp, 'markdown/collections/workout/day1.md'),
      `# Day 1\n\n\`\`\`time\n${script}\n\`\`\`\n`,
    );
    return tmp;
  }

  it('passes a corpus whose wod blocks all parse', () => {
    const tmp = makeCorpus('10 Pullups\n5 Back Squat 100kg');
    try {
      const rows = buildBlockIndexRows(join(tmp, 'markdown'), tmp);
      expect(validateWodBlockSyntax(rows)).toEqual([]);
      // And the full build succeeds end to end.
      const result = generateSeed({ markdownDir: join(tmp, 'markdown'), outDir: join(tmp, 'out'), corpusRoot: tmp, version: 1 });
      expect(result.totalFiles).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails the build on an unparseable block, naming the source file', () => {
    const tmp = makeCorpus('!!! not valid wod at all @@@');
    try {
      expect(() =>
        generateSeed({ markdownDir: join(tmp, 'markdown'), outDir: join(tmp, 'out'), corpusRoot: tmp, version: 1 }),
      ).toThrow(/block syntax gate failed[\s\S]*markdown\/collections\/workout\/day1\.md:1/);
      expect(existsSync(join(tmp, 'out'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts dialect-fenced blocks whose key: value lines the dialect stack owns', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-syntax-dialect-'));
    try {
      mkdirSync(join(tmp, 'markdown/collections/climb'), { recursive: true });
      writeFileSync(
        join(tmp, 'markdown/collections/climb/day1.md'),
        '# Day 1\n\n```log:climbing\ndate: 2026-05-20\nlocation: Red Rock Canyon\ndiscipline: sport\n```\n',
      );
      const rows = buildBlockIndexRows(join(tmp, 'markdown'), tmp);
      expect(validateWodBlockSyntax(rows)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('canvasRouteSlug', () => {
  it('reads the frontmatter route minus the leading slash', () => {
    expect(canvasRouteSlug('---\nroute: /guide/syntax/basics\ntemplate: canvas\n---\n# X')).toBe('guide/syntax/basics');
  });

  it('returns null without frontmatter route or on the degenerate root route', () => {
    expect(canvasRouteSlug('# No frontmatter')).toBeNull();
    expect(canvasRouteSlug('---\nroute: /\n---\n# X')).toBeNull();
  });
  it('rejects route-bearing files that are not canvas pages', () => {
    expect(canvasRouteSlug('---\nroute: /guide/x\ntitle: "X"\n---\n# X')).toBeNull();
  });
});

describe('writer ↔ resolver agreement (ticket 02)', () => {
  // One representative path per chunk family; content matters only for
  // canvas (route frontmatter drives the sourceId).
  const CASES: { path: string; content: string; notebook?: `notebook/${string}`; catalog?: string }[] = [
    { path: 'markdown/collections/girls/fran.md', content: '# Fran\n', notebook: 'notebook/girls', catalog: 'girls' },
    { path: 'markdown/collections/girls/README.md', content: '# Girls\n', notebook: 'notebook/girls', catalog: 'girls' },
    // Root landings: the writer stamps no catalog (chunk `collection._root`
    // / `feed._root`), so they claim no notebook at all.
    { path: 'markdown/collections/README.md', content: '# Collections\n' },
    { path: 'markdown/feeds/README.md', content: '# Feeds\n' },
    { path: 'markdown/feeds/community/2026-01-02/post.md', content: '# Post\n', notebook: 'notebook/community', catalog: 'community' },
    { path: 'markdown/canvas/guide/clock.md', content: '---\nroute: /guide/clock\ntemplate: canvas\n---\n# Clock', notebook: 'notebook/guides' },
    { path: 'markdown/efforts/bodyweight/air-squat.md', content: '# Air Squat\n', notebook: 'notebook/efforts' },
    { path: 'markdown/dashboards/benchmark-pr-board.md', content: '# PR Board\n', notebook: 'notebook/dashboards' },
    { path: 'markdown/equipment/air-bike.md', content: '# Air Bike\n', notebook: 'notebook/equipment' },
  ];

  it('seedNoteSourceId output and the corpus path resolve to the same notebook', () => {
    for (const c of CASES) {
      const chunkId = chunkIdFor(c.path);
      expect(chunkId, c.path).toBeTruthy();
      const sourceId = seedNoteSourceId(c.path, c.content, chunkId!);
      expect(sourceId, c.path).toBeTruthy();
      const stamped = { id: 'seed-note', sourceId, sourcePath: c.path, seedOrigin: 'seed' as const };
      expect(notebookOfItem(stamped), c.path).toEqual(c.notebook);
      // Either writer convention alone lands in the same notebook — the
      // source-id tier and the corpus-path tier never disagree.
      expect(notebookOfItem({ ...stamped, sourceId: undefined }), c.path).toEqual(c.notebook);
      expect(notebookOfItem({ ...stamped, sourcePath: undefined }), c.path).toEqual(c.notebook);
      // The catalog writer and the reader projection agree on EVERY case —
      // catalog chunks carry the directory id, root landings carry none.
      expect(catalogForChunkId(chunkId!), c.path).toBe(catalogOfItem(stamped));
    }
  });
});

describe('buildBlockIndexRows — guides (canvas corpus)', () => {
  function makeCanvasCorpus(): string {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-guides-'));
    mkdirSync(join(tmp, 'markdown/canvas/syntax'), { recursive: true });
    writeFileSync(
      join(tmp, 'markdown/canvas/syntax/basics.md'),
      '---\nroute: /guide/syntax/basics\ntemplate: canvas\n---\n# Basics\n\n```time\n10 Push-ups\n```\n',
    );
    writeFileSync(join(tmp, 'markdown/canvas/syntax/README.md'), '---\nroute: /\n---\n# Home');
    writeFileSync(join(tmp, 'markdown/canvas/syntax/noroute.md'), '# No route declared');
    return tmp;
  }

  it('indexes canvas pages under their route slug with guides provenance', () => {
    const tmp = makeCanvasCorpus();
    try {
      const rows = buildBlockIndexRows(join(tmp, 'markdown'), tmp);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.routeId).toBe('guide/syntax/basics');
        expect(row.sourceId).toBe('guides:guide/syntax/basics');
        expect(row.isStatic).toBe(true);
      }
      const guideRows = rows.filter((r) => r.sourcePath === 'markdown/canvas/syntax/basics.md');
      expect(guideRows).toHaveLength(1);
      expect(guideRows[0].dataType).toBe('wod');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('collection item dates (frontmatter date → block index)', () => {
  function makeDatedCorpus(collectionFm: string, feedFm = ''): string {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-dates-'));
    mkdirSync(join(tmp, 'markdown/collections/daily-box-wod'), { recursive: true });
    mkdirSync(join(tmp, 'markdown/feeds/box/2026-01-12'), { recursive: true });
    writeFileSync(
      join(tmp, 'markdown/collections/daily-box-wod/morning-session.md'),
      `${collectionFm}# Morning session\n\n\`\`\`time\n10 Push-ups\n\`\`\`\n`,
    );
    writeFileSync(join(tmp, 'markdown/feeds/box/2026-01-12/session.md'), `${feedFm}# Session\n\n\`\`\`time\n10 Push-ups\n\`\`\`\n`);
    return tmp;
  }

  it('places a dated collection item on its frontmatter day regardless of filename/directory', () => {
    const tmp = makeDatedCorpus('---\ntitle: Morning session\ndate: 2026-10-16\n---\n');
    try {
      const rows = buildBlockIndexRows(join(tmp, 'markdown'), tmp);
      const dated = rows.filter((r) => r.sourcePath === 'markdown/collections/daily-box-wod/morning-session.md');
      expect(dated.length).toBeGreaterThan(0);
      // Noon UTC (mirrors SeedImporter's Note.date) — timezone-safe civil day.
      for (const row of dated) expect(row.createdAt).toBe(Date.parse('2026-10-16T12:00:00Z'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails the build on an impossible calendar day instead of silently misdating', () => {
    const tmp = makeDatedCorpus('---\ndate: 2026-02-30\n---\n');
    try {
      expect(() => buildBlockIndexRows(join(tmp, 'markdown'), tmp))
        .toThrow(/invalid frontmatter date '2026-02-30'.*morning-session\.md/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps historical feed path dating and lets an authored date override it', () => {
    const undated = makeDatedCorpus('');
    try {
      const rows = buildBlockIndexRows(join(undated, 'markdown'), undated);
      const feed = rows.find((r) => r.sourcePath === 'markdown/feeds/box/2026-01-12/session.md');
      expect(feed!.createdAt).toBe(Date.parse('2026-01-12T00:00:00Z'));
    } finally {
      rmSync(undated, { recursive: true, force: true });
    }
    const dated = makeDatedCorpus('', '---\ndate: 2026-03-05\n---\n');
    try {
      const rows = buildBlockIndexRows(join(dated, 'markdown'), dated);
      const feed = rows.find((r) => r.sourcePath === 'markdown/feeds/box/2026-01-12/session.md');
      expect(feed!.createdAt).toBe(Date.parse('2026-03-05T12:00:00Z'));
    } finally {
      rmSync(dated, { recursive: true, force: true });
    }
  });
});

describe('discoverUncatalogedEfforts & scaffoldDiscoveredEfforts', () => {
  function makeCorpusWithNewEffort(): string {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-effort-discovery-'));
    mkdirSync(join(tmp, 'markdown/efforts/strength'), { recursive: true });
    mkdirSync(join(tmp, 'markdown/collections/workout'), { recursive: true });

    // Existing effort
    writeFileSync(
      join(tmp, 'markdown/efforts/strength/pull-up.md'),
      '---\nid: effort-bundled-pull-up\nslug: pull-up\nlabel: Pull-Up\naliases:\n  - pullups\nbaseAttributes:\n  met: 5.0\n---\n',
    );

    // Workout with an existing effort alias (pullups) and a brand new effort (zercher-squat)
    writeFileSync(
      join(tmp, 'markdown/collections/workout/day1.md'),
      '# Day 1\n\n```time\n10 Pullups\n5 Zercher Squat 60kg\n```\n',
    );
    return tmp;
  }

  it('discovers uncataloged efforts while mapping existing ones via alias', () => {
    const tmp = makeCorpusWithNewEffort();
    try {
      const discovered = discoverUncatalogedEfforts(join(tmp, 'markdown'), tmp);
      expect(discovered.map((d) => d.slug)).toContain('zercher-squat');
      expect(discovered.map((d) => d.slug)).not.toContain('pull-up');
      expect(discovered.map((d) => d.slug)).not.toContain('pullups');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('scaffolds discovered efforts into markdown/efforts/discovered/', () => {
    const tmp = makeCorpusWithNewEffort();
    try {
      const discovered = discoverUncatalogedEfforts(join(tmp, 'markdown'), tmp);
      const createdFiles = scaffoldDiscoveredEfforts(discovered, join(tmp, 'markdown'));
      expect(createdFiles.length).toBe(1);
      const createdPath = createdFiles[0];
      expect(existsSync(createdPath)).toBe(true);
      const content = readFileSync(createdPath, 'utf8');
      expect(content).toContain('slug: zercher-squat');
      expect(content).toContain('Zercher Squat');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves aliases to canonical slugs in buildBlockEffortRows', () => {
    const tmp = makeCorpusWithNewEffort();
    try {
      const rows = buildBlockEffortRows(join(tmp, 'markdown'), tmp);
      const slugs = rows.map((r) => r.effortSlug);
      expect(slugs).toContain('pull-up'); // Pullups mapped to pull-up
      expect(slugs).not.toContain('pullups');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('wod build (CLI)', () => {
  it('builds a corpus dir via the CLI and prints the manifest summary', async () => {
    const tmp = makeTmpCorpus();
    let stdout = '';
    try {
      const code = await cliMain(['build', tmp, '--out', join(tmp, 'cli-out')], {
        stdout: (t) => { stdout += t; },
      });
      expect(code).toBe(0);
      expect(stdout).toContain(`[wod build] schema v${SEED_SCHEMA} version`);
      expect(stdout).toContain('collection.cat1');
      expect(existsSync(join(tmp, 'cli-out', 'manifest.json'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails non-zero on the parity gate and reports the offending file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-cli-parity-'));
    let stderr = '';
    try {
      mkdirSync(join(tmp, 'markdown/sneaky'), { recursive: true });
      writeFileSync(join(tmp, 'markdown/sneaky/x.md'), '# bypass', 'utf8');
      const code = await cliMain(['build', tmp], {
        stdout: () => {},
        stderr: (t) => { stderr += t; },
      });
      expect(code).toBe(1);
      expect(stderr).toContain('Parity failure');
      expect(stderr).toContain('markdown/sneaky/x.md');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a directory without a markdown corpus', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'seed-cli-nocorpus-'));
    let stderr = '';
    try {
      const code = await cliMain(['build', tmp], {
        stdout: () => {},
        stderr: (t) => { stderr += t; },
      });
      expect(code).toBe(1);
      expect(stderr).toContain('No markdown/ corpus');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function makeTmpCorpus(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'seed-test-'));
  mkdirSync(join(tmp, 'markdown/canvas/sub'), { recursive: true });
  mkdirSync(join(tmp, 'markdown/collections/cat1'), { recursive: true });
  mkdirSync(join(tmp, 'markdown/feeds/f'), { recursive: true });
  writeFileSync(join(tmp, 'markdown/canvas/a.md'), '# A');
  writeFileSync(join(tmp, 'markdown/canvas/sub/b.md'), '# B');
  writeFileSync(join(tmp, 'markdown/collections/cat1/c.md'), '# C');
  writeFileSync(join(tmp, 'markdown/feeds/f/d.md'), '# D');
  writeFileSync(join(tmp, 'template.md'), 'new page: {{title}}');
  return tmp;
}

/** A well-formed dashboard note in the locked #899 format (mirrors the community corpus). */
const VALID_DASHBOARD = [
  '---',
  'dashboard: true',
  'title: Benchmark PR Board',
  'domain: crossfit',
  '---',
  '',
  '',
  '# Benchmark PR Board',
  '',
  '## Benchmark scores',
  '',
  '```query:table-2',
  'last:elapsed{tags:benchmark} by {effort}',
  '```',
  '',
  '## Fran trend',
  '',
  '```query:timeseries',
  'last:elapsed{effort:fran} by {week}',
  '```',
  '',
  '## Work capacity',
  '',
  '```query:timeseries',
  'sum:totalReps{} by {week}',
  '```',
  '',
  '## Session intensity',
  '',
  '```query:bar',
  'sum:tis{} by {session, day}',
  '```',
  '',
  '## Consistency',
  '',
  '```query:table-2',
  'count:elapsed{} by {day}',
  '```',
  '',
].join('\n');

/** Same shape but the WQL body does not parse. */
const BAD_WQL_DASHBOARD = [
  '---',
  'dashboard: true',
  'title: Broken Board',
  'domain: crossfit',
  '---',
  '',
  '# Broken Board',
  '',
  '## One',
  '',
  '```query:table-2',
  'last:elapsed{tags:benchmark by {effort}',
  '```',
  '',
  '## Two',
  '',
  '```query:timeseries',
  'last:elapsed{effort:fran} by {week}',
  '```',
  '',
  '## Three',
  '',
  '```query:bar',
  'sum:tis{} by {session, day}',
  '```',
];

/** Well-formed WQL, but references a $token that is never declared. */
const UNDEFINED_TOKEN_DASHBOARD = [
  '---',
  'dashboard: true',
  'title: Token Board',
  'domain: crossfit',
  '---',
  '',
  '# Token Board',
  '',
  '## One',
  '',
  '```query:table-2',
  'last:elapsed{effort:$bench} by {effort}',
  '```',
  '',
  '## Two',
  '',
  '```query:timeseries',
  'last:elapsed{effort:fran} by {week}',
  '```',
  '',
  '## Three',
  '',
  '```query:bar',
  'sum:tis{} by {session, day}',
  '```',
];
