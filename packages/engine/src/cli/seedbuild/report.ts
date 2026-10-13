/**
 * Build report — a static HTML benchmark page for each seed build
 * (`dist/report.html`). Per-chunk sizes, row counts, pass timings, and the
 * git version stamp, so CI and contributors see build health at a glance.
 * Deliberately dependency-free (one string template + a file write).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedManifest } from './contract';

export interface BuildReportData {
  manifest: SeedManifest;
  /** Wall-clock ms for the full build. */
  totalMs: number;
  /** Per-pass timings (ms): corpus scan, block-index derivation, effort-row derivation, chunk writes. */
  passMs: { scan: number; blockIndex: number; parseGate: number; blockEfforts: number; write: number };
  /** Number of corpus markdown files. */
  fileCount: number;
  outDir: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rowHtml(c: SeedManifest['chunks'][number]): string {
  const kind = c.kind ?? 'notes';
  return `<tr><td>${escapeHtml(c.id)}</td><td>${kind}</td><td>${c.count}</td><td>${(c.bytes / 1024).toFixed(1)} KB</td><td><code>${c.sha256.slice(0, 8)}</code></td></tr>`;
}

export function writeBuildReport(outDir: string, data: BuildReportData): string {
  const { manifest, totalMs, passMs, fileCount } = data;
  const totalBytes = manifest.chunks.reduce((s, c) => s + c.bytes, 0);
  const dirtyBadge = manifest.dirty
    ? ' <strong style="color:#b45309">(dirty working tree — not reproducible from <code>' + escapeHtml(manifest.commit ?? '') + '</code>)</strong>'
    : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Seed build report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #e5e7eb; }
  code { font-size: 0.85em; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; font-size: 0.95rem; }
  dt { font-weight: 600; }
</style>
</head>
<body>
<h1>Seed build report</h1>
<h2>Version</h2>
<dl>
  <dt>version</dt><dd>${manifest.version} <code>${escapeHtml(manifest.versionLabel ?? '')}</code>${dirtyBadge}</dd>
  <dt>commit</dt><dd><code>${escapeHtml(manifest.commit ?? 'unknown')}</code></dd>
  <dt>built at</dt><dd>${escapeHtml(manifest.builtAt)}</dd>
  <dt>schema</dt><dd>v${manifest.schema}</dd>
</dl>
<h2>Benchmarks</h2>
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
${manifest.chunks.map(rowHtml).join('\n')}
</tbody>
</table>
</body>
</html>
`;
  const file = join(outDir, 'report.html');
  writeFileSync(file, html, 'utf8');
  return file;
}
