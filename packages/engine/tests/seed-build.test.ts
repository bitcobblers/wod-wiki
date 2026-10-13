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
} from '../src/cli/seedbuild/compiler';
import { SEED_SCHEMA, canvasRouteSlug } from '../src/cli/seedbuild/contract';
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
