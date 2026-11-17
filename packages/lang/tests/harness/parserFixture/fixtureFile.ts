/**
 * Parser fixture file anatomy (spec: wayfinder test-validation-harness
 * asset 001): flat-meta-line frontmatter, `## Script` with a ```wod fence,
 * `## Expected` with `### Line N` metric blocks, or `## Errors`.
 *
 * Diagnostics always name the file and the offending section or line.
 */

import { FixtureSyntaxError, parseMetricLine, type MetricLine } from '../../../src/parser-fixture/metricLine';
import type { MatchMode } from '../../../src/parser-fixture/compare';

export interface ParseFixtureOptions {
  sport?: string;
  withoutDialects?: boolean;
}

export interface ExpectedStatement {
  /** Documented source line — the harness matches positionally. */
  line: number;
  metrics: MetricLine[];
}

export interface ErrorExpectation {
  line: number;
  message: string;
}

export interface ParsedFixture {
  title: string;
  match: MatchMode;
  options: ParseFixtureOptions;
  script: string;
  /** True when a `## Expected` section is present (even with zero blocks). */
  hasExpected: boolean;
  statements: ExpectedStatement[];
  errors: ErrorExpectation[];
}

const FRONTMATTER_KEYS: Record<string, true> = {
  title: true,
  match: true,
  sport: true,
  withoutDialects: true,
};

const KNOWN_SECTIONS: Record<string, true> = {
  Script: true,
  Expected: true,
  Errors: true,
};

/** Parse fixture file content. @param file name for diagnostics. */
export function parseFixtureFile(raw: string, file: string): ParsedFixture {
  const at = (place: string, detail: string): never => {
    throw new FixtureSyntaxError(`${file} [${place}]: ${detail}`);
  };

  const lines = raw.split('\n');

  // ── Frontmatter: flat meta lines ─────────────────────────────────────────
  const meta: Record<string, string> = {};
  let i: number;
  if (lines[0] !== '---') {
    at('frontmatter', 'file must start with a --- frontmatter block');
  }
  for (i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break;
    const m = lines[i].match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!m) {
      at('frontmatter', `line ${i + 1} is not a flat "key: value" entry`);
    }
    if (!FRONTMATTER_KEYS[m[1]]) {
      at('frontmatter', `unknown key "${m[1]}" (known: ${Object.keys(FRONTMATTER_KEYS).join(', ')})`);
    }
    meta[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  if (!meta.title) {
    at('frontmatter', 'title is required');
  }
  if (meta.match !== undefined && meta.match !== 'subset' && meta.match !== 'closed') {
    at('frontmatter', `match must be "subset" or "closed", got "${meta.match}"`);
  }
  const match: MatchMode = meta.match === 'subset' ? 'subset' : 'closed';
  const options: ParseFixtureOptions = {};
  if (meta.sport !== undefined) options.sport = meta.sport;
  if (meta.withoutDialects !== undefined && meta.withoutDialects !== 'true' && meta.withoutDialects !== 'false') {
    at('frontmatter', `withoutDialects must be true/false, got "${meta.withoutDialects}"`);
  }
  if (meta.withoutDialects === 'true') options.withoutDialects = true;

  // ── Sections ─────────────────────────────────────────────────────────────
  const sections: Array<{ name: string; start: number }> = [];
  const seenSections: Record<string, true> = {};
  for (let l = i + 1; l < lines.length; l++) {
    const h = lines[l].match(/^## (.+)$/);
    if (!h) continue;
    const name = h[1].trim();
    if (seenSections[name]) {
      at('anatomy', `duplicate section "## ${name}" — one per file`);
    }
    seenSections[name] = true;
    sections.push({ name, start: l });
  }

  const scriptSection = sections.find((s) => s.name === 'Script');
  if (!scriptSection) {
    at('anatomy', 'required section "## Script" is missing');
  }
  for (const s of sections) {
    if (!KNOWN_SECTIONS[s.name]) {
      at('anatomy', `unknown section "## ${s.name}" (known: Script, Expected, Errors)`);
    }
  }

  const expectedSection = sections.find((s) => s.name === 'Expected');
  const errorsSection = sections.find((s) => s.name === 'Errors');
  if (expectedSection && errorsSection) {
    at('anatomy', '## Errors and ## Expected are mutually exclusive — assert one');
  }

  // ── Script: extract the ```wod fence ─────────────────────────────────────
  const scriptEnd = sectionEnd(sections, scriptSection, lines.length);
  const fenceOpen = findFenceOpen(lines, scriptSection.start + 1, scriptEnd);
  if (fenceOpen === -1) {
    at('## Script', 'no ```wod fence found');
  }
  const fenceClose = lines.indexOf('```', fenceOpen + 1);
  if (fenceClose === -1 || fenceClose > scriptEnd) {
    at('## Script', '```wod fence is not closed');
  }
  const script = lines.slice(fenceOpen + 1, fenceClose).join('\n');

  // ── Errors ───────────────────────────────────────────────────────────────
  const errors: ErrorExpectation[] = [];
  if (errorsSection) {
    const end = sectionEnd(sections, errorsSection, lines.length);
    for (let l = errorsSection.start + 1; l < end; l++) {
      if (lines[l].trim() === '') continue;
      const m = lines[l].match(/^- line (\d+): "(.*)"$/);
      if (!m) {
        at(`## Errors, line ${l + 1}`, 'error entries must look like: - line <n>: "<message>"');
      }
      errors.push({ line: Number(m[1]), message: m[2] });
    }
  }

  // ── Expected: ### Line N blocks with metric lines ────────────────────────
  const statements: ExpectedStatement[] = [];
  if (expectedSection) {
    const end = sectionEnd(sections, expectedSection, lines.length);
    let current: ExpectedStatement | null = null;
    for (let l = expectedSection.start + 1; l < end; l++) {
      const line = lines[l];
      const header = line.match(/^### Line (\d+)$/);
      if (header) {
        if (current) statements.push(current);
        current = { line: Number(header[1]), metrics: [] };
        continue;
      }
      if (line.startsWith('- ')) {
        if (!current) {
          at(`## Expected, line ${l + 1}`, 'metric lines need a "### Line N" block first');
        }
        current!.metrics.push(parseMetricLine(line, file, l + 1));
        continue;
      }
      if (line.trim() === '') continue;
      at(`## Expected, line ${l + 1}`, `unrecognized line ${JSON.stringify(line)} (want "### Line N" or "- metric")`);
    }
    if (current) statements.push(current);
  }

  return { title: meta.title, match, options, script, hasExpected: expectedSection !== undefined, statements, errors };
}

/** End line (exclusive) of a section — the next `## ` header or EOF. */
function sectionEnd(
  sections: Array<{ name: string; start: number }>,
  section: { start: number },
  fileEnd: number,
): number {
  const next = sections
    .map((s) => s.start)
    .filter((start) => start > section.start)
    .sort((a, b) => a - b)[0];
  return next ?? fileEnd;
}

/** Index of the first ```wod fence opener in [from, to), or -1. */
function findFenceOpen(lines: string[], from: number, to: number): number {
  for (let l = from; l < to; l++) {
    if (lines[l].trim() === '```wod') return l;
  }
  return -1;
}
