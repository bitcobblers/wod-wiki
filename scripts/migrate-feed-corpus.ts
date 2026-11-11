#!/usr/bin/env bun
/**
 * scripts/migrate-feed-corpus.ts
 *
 * Upgrades a WOD Wiki corpus or `wod-wiki-feed-repository` checkout to the
 * ADR-0005 strict `.md` + companion `.jsonl` contract:
 *   1. Strips any legacy `## Metadata / ## Content` wrapper into canonical YAML frontmatter.
 *   2. Normalizes companion `.jsonl` files so `{ kind: "note" }` records are moved/merged
 *      into the `.md` frontmatter and `.jsonl` carries pure `revision` / `parse` / `session` / `event`
 *      telemetry (stamping `public: true` on published feed sessions).
 *   3. Converts standalone Session `.csv` companions to `.jsonl` when requested (`--csv-to-jsonl`).
 *   4. Rebuilds `dist/` Seed artifacts (`manifest.json`, `indexes/notebooks/*.json`, `chunks/*.json`, `index.html`).
 *
 * Usage:
 *   bun scripts/migrate-feed-corpus.ts [target-repo-dir] [--write] [--csv-to-jsonl] [--build]
 */

import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  csvToTelemetryBundle,
  injectIdentityFrontmatter,
  parseNoteBundleFromJsonl,
  serializeNoteBundleToJsonl,
  seedNoteId,
} from '@bitcobblers/wod-wiki-engine';
import { generateSeed } from '../packages/tools/src/seedbuild/compiler';

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function upgradeLegacyWrappedMarkdown(raw: string): { changed: boolean; content: string } {
  const legacyMatch = /^#\s+(.+?)\r?\n\s*## Metadata\s+([\s\S]*?)\s+## Content\r?\n(?:\r?\n)?([\s\S]*)$/.exec(raw);
  if (!legacyMatch) return { changed: false, content: raw };

  const title = legacyMatch[1]!.trim();
  const metaBlock = legacyMatch[2]!;
  const body = legacyMatch[3]!;
  const meta: Record<string, string> = {};
  for (const line of metaBlock.split(/\r?\n/)) {
    const kv = /^-\s+\*\*(.+?)\*\*:\s*(.+)$/.exec(line.trim());
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }

  const dateIso = meta['Target Date'] ? new Date(meta['Target Date']).toISOString().slice(0, 10) : undefined;
  const noteId = meta['ID'];
  const stamped = noteId
    ? injectIdentityFrontmatter(body, {
        noteId,
        title,
        ...(dateIso ? { date: dateIso } : {}),
      })
    : body;
  return { changed: true, content: stamped };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const csvToJsonl = args.includes('--csv-to-jsonl');
  const runBuild = args.includes('--build');
  const posDir = args.find((a) => !a.startsWith('--')) ?? '.';
  const rootDir = resolve(process.cwd(), posDir);
  const markdownDir = join(rootDir, 'markdown');

  if (!existsSync(markdownDir)) {
    process.stderr.write(`[migrate-feed-corpus] No markdown/ directory found under ${rootDir}\n`);
    process.exit(1);
  }

  const allFiles = walkFiles(markdownDir);
  let upgradedMd = 0;
  let normalizedJsonl = 0;
  let convertedCsv = 0;

  for (const file of allFiles) {
    if (file.endsWith('.md') && !file.endsWith('README.md')) {
      const raw = readFileSync(file, 'utf8');
      const res = upgradeLegacyWrappedMarkdown(raw);
      if (res.changed) {
        upgradedMd++;
        if (write) writeFileSync(file, res.content, 'utf8');
      }
    } else if (file.endsWith('.jsonl')) {
      const raw = readFileSync(file, 'utf8');
      const rel = file.slice(rootDir.length + 1).replace(/\\/g, '/').replace(/\.jsonl$/, '.md');
      const deterministicNoteId = await seedNoteId(rel);
      const parsed = parseNoteBundleFromJsonl(raw);
      let dirty = false;
      const cleanedBundles = parsed.bundles.map((b) => {
        if (b.note !== undefined) dirty = true;
        const sessions = b.sessions.map((s) => {
          if (s.public !== true || s.noteId !== deterministicNoteId) dirty = true;
          return { ...s, noteId: deterministicNoteId, public: true };
        });
        const events = b.events.map((ev) => {
          if (ev.noteId !== deterministicNoteId) dirty = true;
          return { ...ev, noteId: deterministicNoteId };
        });
        return {
          ...(b.revisions ? { revisions: b.revisions } : {}),
          ...(b.parses ? { parses: b.parses } : {}),
          sessions,
          events,
        };
      });
      if (dirty) {
        normalizedJsonl++;
        if (write) {
          const out = cleanedBundles.map(serializeNoteBundleToJsonl).filter(Boolean).join('\n') + '\n';
          writeFileSync(file, out, 'utf8');
        }
      }
    } else if (csvToJsonl && file.endsWith('.csv')) {
      const raw = readFileSync(file, 'utf8');
      const parsed = csvToTelemetryBundle(raw);
      if (parsed.bundles.length > 0 && parsed.errors.length === 0) {
        convertedCsv++;
        if (write) {
          const jsonlPath = file.replace(/\.csv$/, '.jsonl');
          const out = parsed.bundles.map(serializeNoteBundleToJsonl).filter(Boolean).join('\n') + '\n';
          writeFileSync(jsonlPath, out, 'utf8');
          unlinkSync(file);
        }
      }
    }
  }

  process.stdout.write(
    `[migrate-feed-corpus] Scanned ${allFiles.length} file(s) in ${markdownDir} (${write ? 'WRITE' : 'DRY-RUN'}): ` +
      `${upgradedMd} .md wrapper(s) upgraded, ${normalizedJsonl} .jsonl file(s) normalized, ${convertedCsv} .csv file(s) converted.\n`,
  );

  if (runBuild) {
    const built = generateSeed({ corpusRoot: rootDir, outDir: join(rootDir, 'dist') });
    process.stdout.write(
      `[migrate-feed-corpus] Built Seed schema v${built.manifest.schema} (${built.manifest.chunks.length} chunks, ${built.totalFiles} files) → ${built.outDir}\n`,
    );
  }
}

await main();
