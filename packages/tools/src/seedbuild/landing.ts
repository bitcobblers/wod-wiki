/**
 * Feed landing page — the static HTML entry point of a compiled feed
 * (`index.html` at the output root, so a hosted feed serves it at its
 * directory URL).
 *
 * Two audiences, one page: the build report (version stamp, per-pass
 * timings, chunk table) that CI and contributors read, and the feed
 * contents (every notebook and note the feed publishes, with its raw
 * markdown) that a subscriber reads before subscribing.
 *
 * The page also carries the subscription controls: a whole-feed link, a
 * per-notebook link, and a QR code for each. Their URLs resolve in the
 * page (the hosted feed URL is only known at runtime) via the inlined
 * encoder in `qr.ts`.
 *
 * Deliberately dependency-free (one string template + a file write).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedManifest } from './contract';
import { APP_ORIGIN, QR_SCRIPT_ID, qrInlineScript } from './qr';

/** One note (workout) the feed publishes. */
export interface LandingNote {
  /** Display title — the note's own title, or a filename fallback. */
  title: string;
  /** Note source path inside the feed repository (e.g. `markdown/notebooks/x/y.md`). */
  path: string;
  /** Epoch ms of the note's authored date, when known. */
  date?: number;
  /** Path of the compiled record JSON, relative to the feed root. */
  recordPath?: string;
  /** Raw markdown source — rendered verbatim in a collapsed block. */
  content?: string;
}

/** One notebook the feed publishes. */
export interface LandingNotebook {
  /** Notebook id (the chunk id, e.g. `notebook.example`). */
  id: string;
  /** Human label for the notebook. */
  label: string;
  notes: LandingNote[];
}

export interface FeedLandingData {
  manifest: SeedManifest;
  /** Wall-clock ms for the full build. */
  totalMs: number;
  /** Per-pass timings (ms): corpus scan, block-index derivation, effort-row derivation, chunk writes. */
  passMs: { scan: number; blockIndex: number; parseGate: number; blockEfforts: number; write: number };
  /** Number of corpus markdown files (or published notes, for `wod publish`). */
  fileCount: number;
  /** Notebooks (and their notes) the feed publishes. */
  notebooks: LandingNotebook[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isoDate(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function chunkRowHtml(c: SeedManifest['chunks'][number]): string {
  const kind = c.kind ?? 'notes';
  return `<tr><td>${escapeHtml(c.id)}</td><td>${kind}</td><td>${c.count}</td><td>${(c.bytes / 1024).toFixed(1)} KB</td><td><code>${c.sha256.slice(0, 8)}</code></td></tr>`;
}

function noteHtml(note: LandingNote): string {
  const date = isoDate(note.date);
  const meta = [date, `<code>${escapeHtml(note.path)}</code>`].filter(Boolean).join(' · ');
  const source = note.content
    ? `<details><summary>source</summary><pre>${escapeHtml(note.content)}</pre></details>`
    : '';
  const record = note.recordPath ? ` · <a href="${escapeHtml(note.recordPath)}">record</a>` : '';
  return `      <li><span class="title">${escapeHtml(note.title)}</span> <span class="meta">${meta}${record}</span>${source}</li>`;
}

function notebookHtml(notebook: LandingNotebook): string {
  const notes = notebook.notes.map(noteHtml).join('\n');
  return `    <section class="notebook">
      <h3>${escapeHtml(notebook.label)} <small>${escapeHtml(notebook.id)} · ${notebook.notes.length} note${notebook.notes.length === 1 ? '' : 's'}</small></h3>
      <p class="subscribe-row"><a class="subscribe" data-subscribe-notebook="${escapeHtml(notebook.id)}">Subscribe to Notebook</a> <details class="qr"><summary>QR</summary><div class="qr-body" data-qr-notebook="${escapeHtml(notebook.id)}"></div></details></p>
      <ul>
${notes}
      </ul>
    </section>`;
}

/**
 * The whole-feed subscribe control. Its `href` and QR payload resolve in
 * the page (the hosted feed URL is only known at runtime), so the markup
 * ships the hook and the inline script fills it in.
 */
function feedSubscribeHtml(): string {
  return `  <section class="subscribe">
    <a class="subscribe primary" data-subscribe-feed>Subscribe to Whole Feed</a>
    <details class="qr"><summary>QR</summary><div class="qr-body" data-qr-feed></div></details>
    <p class="meta">Opens Wod.Wiki and subscribes to every notebook this feed publishes. <noscript>JavaScript is off — subscribe from Wod.Wiki with this feed's URL.</noscript></p>
  </section>`;
}

/**
 * Write the feed landing page (`index.html`) into `outDir` and return its
 * path. The file sits at the output root, so a static host serves it at
 * the feed's directory URL.
 */
export function writeFeedLanding(outDir: string, data: FeedLandingData): string {
  const { manifest, totalMs, passMs, fileCount, notebooks } = data;
  const totalBytes = manifest.chunks.reduce((s, c) => s + c.bytes, 0);
  const totalNotes = notebooks.reduce((s, n) => s + n.notes.length, 0);
  const dirtyBadge = manifest.dirty
    ? ' <strong style="color:#b45309">(dirty working tree — not reproducible from <code>' + escapeHtml(manifest.commit ?? '') + '</code>)</strong>'
    : '';
  const title = manifest.name ? `${manifest.name} — feed` : 'Feed';
  const description = manifest.description ? `<p class="desc">${escapeHtml(manifest.description)}</p>` : '';
  const repoLink = manifest.repositoryUrl
    ? `<p class="meta"><a href="${escapeHtml(manifest.repositoryUrl)}">${escapeHtml(manifest.repositoryUrl)}</a></p>`
    : '';
  const notebookSections = notebooks.map(notebookHtml).join('\n');
  const contents = notebooks.length
    ? notebookSections
    : '    <p class="meta">This feed publishes no notebooks yet.</p>';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  h3 { font-size: 1rem; margin: 1.25rem 0 .25rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #e5e7eb; }
  code { font-size: 0.85em; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; font-size: 0.95rem; }
  dt { font-weight: 600; }
  ul { list-style: none; padding-left: 0; margin: .25rem 0 0; }
  li { padding: .35rem 0; border-bottom: 1px solid #e5e7eb; }
  li .title { font-weight: 600; }
  .meta { color: #6b7280; font-size: 0.85rem; }
  .desc { font-size: 1rem; }
  pre { overflow-x: auto; background: #f3f4f6; padding: 0.6rem; border-radius: 0.25rem; font-size: 0.8rem; }
  summary { cursor: pointer; color: #6b7280; font-size: 0.85rem; }
  small { font-weight: 400; color: #6b7280; }
  .subscribe { display: inline-block; padding: .4rem .8rem; border: 1px solid #1f2937; border-radius: .25rem; color: #1f2937; text-decoration: none; font-size: .9rem; }
  .subscribe.primary { background: #1f2937; color: #fff; }
  .subscribe-row { margin: .4rem 0 .2rem; }
  .qr { display: inline-block; vertical-align: middle; margin-left: .5rem; }
  .qr-body { padding: .4rem 0; }
  .qr-svg { width: 132px; height: 132px; display: block; }
</style>
</head>
<body>
<h1>${escapeHtml(manifest.name ?? 'Feed')}</h1>
${description}
${repoLink}
<p class="meta"><a href="manifest.json">manifest.json</a> — the artifact subscribers import.</p>
${feedSubscribeHtml()}
<h2>Contents</h2>
<p class="meta">${notebooks.length} notebook${notebooks.length === 1 ? '' : 's'} · ${totalNotes} note${totalNotes === 1 ? '' : 's'}</p>
${contents}
<h2>Version</h2>
<dl>
  <dt>version</dt><dd>${manifest.version} <code>${escapeHtml(manifest.versionLabel ?? '')}</code>${dirtyBadge}</dd>
  <dt>commit</dt><dd><code>${escapeHtml(manifest.commit ?? 'unknown')}</code></dd>
  <dt>built at</dt><dd>${escapeHtml(manifest.builtAt)}</dd>
  <dt>schema</dt><dd>v${manifest.schema}</dd>
</dl>
<h2>Build report</h2>
<dl>
  <dt>total</dt><dd>${totalMs} ms</dd>
  <dt>corpus scan + partition</dt><dd>${passMs.scan} ms (${fileCount} files)</dd>
  <dt>block-index derivation</dt><dd>${passMs.blockIndex} ms</dd>
  <dt>block syntax gate</dt><dd>${passMs.parseGate} ms</dd>
  <dt>block-efforts derivation</dt><dd>${passMs.blockEfforts} ms</dd>
  <dt>chunk writes</dt><dd>${passMs.write} ms</dd>
</dl>
<h2>Chunks (${manifest.chunks.length}, ${(totalBytes / 1024).toFixed(0)} KB total)</h2>
<table>
<thead><tr><th>id</th><th>kind</th><th>rows</th><th>size</th><th>sha256</th></tr></thead>
<tbody>
${manifest.chunks.map(chunkRowHtml).join('\n')}
</tbody>
</table>
<script id="${QR_SCRIPT_ID}">
${qrInlineScript(APP_ORIGIN)}
</script>
</body>
</html>
`;
  const file = join(outDir, 'index.html');
  writeFileSync(file, html, 'utf8');
  return file;
}
