/**
 * sync-seed — build the bundled seed artifacts into
 * apps/playground/public/seed/<sourceId>/ from this repo's own corpus.
 *
 * The playground bundles ONE source: `core` — this repo's markdown/ corpus
 * (the playground's own canvas pages) plus the playground template, versioned
 * by THIS repo's git history. The community corpus is NOT built here; it
 * publishes to its own repo's GitHub Pages (wod-wiki-community) and the app
 * syncs it over HTTP at runtime (see seedSources.ts). Third-party seed
 * libraries register the same way.
 *
 * The corpus compiles through the engine's seed compiler (the `wod build`
 * engine, imported from source below), so every seed library — bundled or
 * remote — goes through the same parity + dashboard gates. This script only
 * orchestrates; requires the workspace's node_modules.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Repo-internal import: the seed compiler is not exported from the engine
// package index (that index is browser-bundled; seedbuild statically imports
// node builtins). The `wod build` CLI is the public surface.
import { generateSeed } from '../packages/engine/src/cli/seedbuild/compiler';

interface ManifestChunkRef {
  id: string;
  sha256: string;
  count?: number;
  bytes?: number;
}

interface SeedManifestRef {
  version: number;
  versionLabel?: string;
  commit?: string;
  dirty?: boolean;
  builtAt: string;
  chunks: ManifestChunkRef[];
}

interface SeedSourceSpec {
  id: string;
  corpusRoot: string;
  markdownDir: string;
  outDir: string;
  template: boolean;
}

const ROOT = resolve(import.meta.dirname, '..');
const TEMPLATE_FILE = join(ROOT, 'apps', 'playground', 'app', 'templates', 'new-playground.md');
/** Historical in-repo row path for the template chunk — the runtime derives the template note's id from it; must stay stable. */
const TEMPLATE_ROW_PATH = 'apps/playground/app/templates/new-playground.md';
const SEED_PUBLIC_DIR = join(ROOT, 'apps', 'playground', 'public', 'seed');

const SOURCES: SeedSourceSpec[] = [
  // Core: this repo's own corpus + the playground template.
  {
    id: 'core',
    corpusRoot: ROOT,
    markdownDir: join(ROOT, 'markdown'),
    outDir: join(SEED_PUBLIC_DIR, 'core'),
    template: true,
  },
];

const results: Array<{ spec: SeedSourceSpec; manifest: SeedManifestRef }> = [];
for (const spec of SOURCES) {
  // Previous manifest for the change report (generateSeed wipes OUT_DIR).
  let prevManifest: SeedManifestRef | undefined;
  try {
    prevManifest = JSON.parse(readFileSync(join(spec.outDir, 'manifest.json'), 'utf8')) as SeedManifestRef;
  } catch {
    // First sync — everything is "added".
  }

  const { manifest, reportPath, passMs } = generateSeed({
    markdownDir: spec.markdownDir,
    corpusRoot: spec.corpusRoot,
    outDir: spec.outDir,
    ...(spec.template ? { templateFile: TEMPLATE_FILE, templateRowPath: TEMPLATE_ROW_PATH } : {}),
  });

  const prevChunks = prevManifest?.chunks ?? [];
  const prevById = new Map(prevChunks.map((c) => [c.id, c.sha256]));
  const nextById = new Map(manifest.chunks.map((c) => [c.id, c.sha256]));
  const added = manifest.chunks.filter((c) => !prevById.has(c.id)).map((c) => c.id);
  const removed = prevChunks.filter((c) => !nextById.has(c.id)).map((c) => c.id);
  const changed = manifest.chunks.filter((c) => prevById.has(c.id) && prevById.get(c.id) !== c.sha256).map((c) => c.id);

  console.log(`[sync-seed] ${spec.id}: seed ${manifest.version} (${manifest.versionLabel ?? 'unversioned'}, commit ${(manifest.commit ?? '').slice(0, 8)})${manifest.dirty ? ' [dirty]' : ''} → ${spec.outDir}`);
  if (prevChunks.length > 0) {
    console.log(
      `[sync-seed] ${spec.id}: vs previous (${prevManifest?.versionLabel ?? prevManifest?.version}): ` +
      `${changed.length} changed, ${added.length} added, ${removed.length} removed, ` +
      `${manifest.chunks.length - changed.length - added.length} unchanged`,
    );
    for (const id of changed) console.log(`  ~ ${id}`);
    for (const id of added) console.log(`  + ${id}`);
    for (const id of removed) console.log(`  - ${id}`);
  } else {
    console.log(`[sync-seed] ${spec.id}: first sync — ${manifest.chunks.length} chunks`);
  }
  console.log(`[sync-seed] ${spec.id}: report: ${reportPath} (scan ${passMs.scan}ms, block-index ${passMs.blockIndex}ms, parse-gate ${passMs.parseGate}ms, block-efforts ${passMs.blockEfforts}ms, write ${passMs.write}ms)`);
  results.push({ spec, manifest });
}

/**
 * seed index — one static HTML page (served at `/seed/index.html`) listing
 * every compiled source: version, commit, build time, chunk stats, and links
 * to each source's `report.html` and `manifest.json`. Regenerated on every
 * sync (dev and build run sync-seed before vite), so it always reflects the
 * published artifacts with zero runtime fetches.
 */
function writeSeedIndex(entries: Array<{ spec: SeedSourceSpec; manifest: SeedManifestRef }>): void {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sections = entries.map(({ spec, manifest }) => {
    const bytes = manifest.chunks.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
    const rows = manifest.chunks.reduce((sum, c) => sum + (c.count ?? 0), 0);
    return `  <section>
    <h2><a href="${spec.id}/report.html">${escape(spec.id)}</a> <small>v${manifest.version}${manifest.dirty ? ' (dirty)' : ''}</small></h2>
    <p><code>${escape(manifest.commit ?? 'unknown')}</code> · built ${escape(manifest.builtAt)} · ${manifest.chunks.length} chunks · ${rows} rows · ${(bytes / 1024).toFixed(0)} KB</p>
    <p><a href="${spec.id}/manifest.json">manifest.json</a> · <a href="${spec.id}/report.html">build report</a></p>
  </section>`;
  });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seed index</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; } h2 { font-size: 1rem; margin: 0 0 .25rem; }
  section { border-top: 1px solid #8884; padding: .75rem 0; }
  small { font-weight: 400; opacity: .7; }
  code { font-family: ui-monospace, monospace; font-size: .85em; }
</style>
</head>
<body>
<h1>Seed index</h1>
<p>Compiled content corpora bundled with this build. The app imports each source's <code>manifest.json</code> at boot and fetches changed chunks.</p>
${sections.join('\n')}
</body>
</html>
`;
  writeFileSync(join(SEED_PUBLIC_DIR, 'index.html'), html);
  console.log(`[sync-seed] index: ${join(SEED_PUBLIC_DIR, 'index.html')} (${entries.length} sources)`);
}

writeSeedIndex(results);
