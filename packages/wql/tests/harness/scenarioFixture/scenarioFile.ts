/**
 * Scenario file parser for WQL scenarios (spec: wayfinder
 * test-validation-harness asset 006).
 */

export class ScenarioSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioSyntaxError';
  }
}

export type ScenarioMatchMode = 'closed' | 'subset';

export interface ExpectedSeriesPoint {
  dateOrTs: string | number;
  value: number;
}

export interface ExpectedSeries {
  key: string;
  value?: number;
  unit?: string;
  points?: ExpectedSeriesPoint[];
}

export interface ExpectedEvent {
  id: string;
  grain: string;
  outputType: string;
  metricsSummary: string;
}

export interface ExpectedRun {
  resultId: string;
  noteId?: string;
  events: ExpectedEvent[];
}

export interface ExpectedOutput {
  scalar?: number;
  unit?: string;
  series?: ExpectedSeries[];
  runs?: ExpectedRun[];
}

export interface ParsedScenario {
  title: string;
  corpus: string;
  preferredUnit?: string;
  rangeEnd?: number;
  match: ScenarioMatchMode;
  query: string;
  expected?: ExpectedOutput;
  errors?: string[];
}

const FRONTMATTER_KEYS: Record<string, true> = {
  title: true,
  corpus: true,
  preferredUnit: true,
  rangeEnd: true,
  match: true,
};

const KNOWN_SECTIONS: Record<string, true> = {
  Query: true,
  Expected: true,
  Errors: true,
};

export function parseScenarioFile(raw: string, file: string): ParsedScenario {
  const at = (place: string, detail: string): never => {
    throw new ScenarioSyntaxError(`${file} [${place}]: ${detail}`);
  };

  const lines = raw.split('\n');

  // ── Frontmatter ──────────────────────────────────────────────────────────
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

  const title = meta.title;
  const corpus = meta.corpus || 'crossfit-multi-week';
  const preferredUnit = meta.preferredUnit;
  const rangeEnd = meta.rangeEnd ? Number(meta.rangeEnd) : undefined;
  const match: ScenarioMatchMode = meta.match === 'subset' ? 'subset' : 'closed';

  // ── Sections ─────────────────────────────────────────────────────────────
  const sections: Array<{ name: string; start: number }> = [];
  const seenSections: Record<string, true> = {};
  for (let l = i + 1; l < lines.length; l++) {
    const h = lines[l].match(/^## (.+)$/);
    if (!h) continue;
    const name = h[1].trim();
    if (seenSections[name]) {
      at('anatomy', `duplicate section "## ${name}"`);
    }
    seenSections[name] = true;
    sections.push({ name, start: l });
  }

  const querySection = sections.find((s) => s.name === 'Query');
  if (!querySection) {
    at('anatomy', 'required section "## Query" is missing');
  }
  for (const s of sections) {
    if (!KNOWN_SECTIONS[s.name]) {
      at('anatomy', `unknown section "## ${s.name}"`);
    }
  }

  const expectedSection = sections.find((s) => s.name === 'Expected');
  const errorsSection = sections.find((s) => s.name === 'Errors');
  if (expectedSection && errorsSection) {
    at('anatomy', '## Errors and ## Expected are mutually exclusive');
  }

  // ── Query Fence ──────────────────────────────────────────────────────────
  const queryEnd = sectionEnd(sections, querySection, lines.length);
  const fenceOpen = findFenceOpen(lines, querySection.start + 1, queryEnd);
  if (fenceOpen === -1) {
    at('## Query', 'no ```wql fence found');
  }
  const fenceClose = lines.indexOf('```', fenceOpen + 1);
  if (fenceClose === -1 || fenceClose > queryEnd) {
    at('## Query', '```wql fence is not closed');
  }
  const query = lines.slice(fenceOpen + 1, fenceClose).join('\n').trim();

  // ── Errors Section ───────────────────────────────────────────────────────
  let errors: string[] | undefined;
  if (errorsSection) {
    errors = [];
    const end = sectionEnd(sections, errorsSection, lines.length);
    for (let l = errorsSection.start + 1; l < end; l++) {
      const line = lines[l].trim();
      if (!line) continue;
      const m = line.match(/^- "(.*)"$/) || line.match(/^- (.*)$/);
      if (m) {
        errors.push(m[1].replace(/\\"/g, '"'));
      }
    }
  }

  // ── Expected Section ─────────────────────────────────────────────────────
  let expected: ExpectedOutput | undefined;
  if (expectedSection) {
    expected = {};
    const end = sectionEnd(sections, expectedSection, lines.length);
    let currentSeries: ExpectedSeries | null = null;
    let currentRun: ExpectedRun | null = null;

    for (let l = expectedSection.start + 1; l < end; l++) {
      const line = lines[l].trim();
      if (!line) continue;

      const seriesHdr = line.match(/^### Series (.+)$/);
      if (seriesHdr) {
        if (currentSeries) {
          expected.series = expected.series || [];
          expected.series.push(currentSeries);
        }
        currentSeries = { key: seriesHdr[1].trim() };
        continue;
      }

      const runHdr = line.match(/^### Run (.+)$/);
      if (runHdr) {
        if (currentRun) {
          expected.runs = expected.runs || [];
          expected.runs.push(currentRun);
        }
        currentRun = { resultId: runHdr[1].trim(), events: [] };
        continue;
      }

      if (currentRun) {
        const noteMatch = line.match(/^- note:\s*(.+)$/);
        if (noteMatch) {
          currentRun.noteId = noteMatch[1].trim();
          continue;
        }
        const eventMatch = line.match(/^- event\s+([^\s]+)\s+\[([^/]+)\/([^\]]+)\]\s*(.*)$/);
        if (eventMatch) {
          currentRun.events.push({
            id: eventMatch[1],
            grain: eventMatch[2],
            outputType: eventMatch[3],
            metricsSummary: eventMatch[4],
          });
          continue;
        }
      }

      if (currentSeries) {
        const valMatch = line.match(/^- value:\s*(-?\d+(\.\d+)?)$/);
        if (valMatch) {
          currentSeries.value = Number(valMatch[1]);
          continue;
        }
        const unitMatch = line.match(/^- unit:\s*(.+)$/);
        if (unitMatch) {
          currentSeries.unit = unitMatch[1].trim();
          continue;
        }
        const pointMatch = line.match(/^- point\s+([^:]+):\s*(-?\d+(\.\d+)?)$/)
          || line.match(/^- point:\s*(-?\d+(\.\d+)?)$/);
        if (pointMatch) {
          currentSeries.points = currentSeries.points || [];
          if (pointMatch[2] !== undefined) {
            const rawTs = pointMatch[1].trim();
            const dateOrTs = /^\d+$/.test(rawTs) ? Number(rawTs) : rawTs;
            currentSeries.points.push({ dateOrTs, value: Number(pointMatch[2]) });
          } else {
            currentSeries.points.push({ dateOrTs: '', value: Number(pointMatch[1]) });
          }
          continue;
        }
      }

      // Top-level scalar/unit
      const scalarMatch = line.match(/^- scalar:\s*(-?\d+(\.\d+)?)$/);
      if (scalarMatch) {
        expected.scalar = Number(scalarMatch[1]);
        continue;
      }
      const unitMatch = line.match(/^- unit:\s*(.+)$/);
      if (unitMatch) {
        expected.unit = unitMatch[1].trim();
      }
    }

    if (currentSeries) {
      expected.series = expected.series || [];
      expected.series.push(currentSeries);
    }
    if (currentRun) {
      expected.runs = expected.runs || [];
      expected.runs.push(currentRun);
    }
  }

  return { title, corpus, preferredUnit, rangeEnd, match, query, expected, errors };
}

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

function findFenceOpen(lines: string[], from: number, to: number): number {
  for (let l = from; l < to; l++) {
    if (lines[l].trim() === '```wql') return l;
  }
  return -1;
}
