/**
 * guideGroups.ts — pure grouping for the live syntax guides: partitions a
 * page's parsed content sections into small semantic runway runs (2-4 stages)
 * and a static accessible tail, and derives the per-group scroll stages
 * consumed by useScrollRunway. No content is rewritten or dropped — grouping
 * only decides where each existing CanvasSection renders.
 */
import type { CanvasSection, ScrollStage } from './parseCanvasMarkdown'

/** Terminal meta section stays in normal flow after the runways so it
 *  remains fully accessible (the compact reference). The old What's Next
 *  button block is gone — the GuideIndexFooter list carries next-chapter
 *  navigation now. */
const STATIC_TAIL_IDS: Record<string, true> = { reference: true }

/**
 * Semantic runs per guide slug (section ids in document order) — each guide's
 * chapters grouped by concept, keeping h3 subsections beside their parent.
 * The reference never appears here (static tail); Try-it closes the
 * last run so its Run/source buttons act on the panel beside it.
 */
const SEMANTIC_GROUPS: Record<string, string[][]> = {
  start: [
    ['fences', 'first-workout'],
    ['measurements', 'actions-comments'],
    ['system', 'try-it'],
  ],
  protocols: [
    ['countdown-countup', 'required-rest'],
    ['amrap', 'emom'],
    ['tabata-intervals', 'caps', 'distance-intervals', 'try-it'],
  ],
  structure: [
    ['rounds', 'rep-schemes', 'sets'],
    ['nesting', 'rep-math', 'named-sections', 'try-it'],
  ],
  metrics: [
    ['planned-vs-recorded', 'custom-metrics'],
    ['capture', 'session-rpe'],
    ['calculated', 'try-it'],
  ],
  clock: [
    ['run-next', 'pause-skip'],
    ['capture-prompts', 'casting', 'provenance', 'try-it'],
  ],
  wql: [
    ['planes', 'aggregate', 'filters', 'sources'],
    ['windows', 'grouping-rollup', 'joins'],
    ['content', 'pipes', 'try-it'],
  ],
  dashboards: [
    ['note-frontmatter', 'avg-tis', 'weekly-tonnage', 'widgets'],
    ['composer', 'cookbook', 'seeded-boards', 'try-it'],
  ],
  sessions: [
    ['intent', 'full-session'],
    ['nested', 'partner', 'swimming'],
    ['barbell-cycling', 'climbing', 'try-it'],
  ],
  'metrics-summaries': [
    ['frontmatter-metrics', 'tag-summaries', 'stacking-overrides'],
    ['querying-summaries', 'dependency-diagnostics', 'try-it'],
  ],
}

export interface GuideGrouping {
  /** Consecutive stage groups (each renders as one RunwayShell track). */
  groups: CanvasSection[][]
  /** Static tail sections in original order. */
  tail: CanvasSection[]
}

export function groupGuideSections(sections: CanvasSection[], groupKey?: string): GuideGrouping {
  const staged = sections.filter((s) => !STATIC_TAIL_IDS[s.id])
  const tail = sections.filter((s) => STATIC_TAIL_IDS[s.id])
  if (staged.length === 0) return { groups: [], tail }

  const map = groupKey ? SEMANTIC_GROUPS[groupKey] : undefined
  if (map) {
    const byId = new Map(staged.map((s) => [s.id, s]))
    const covered = new Set<string>()
    const groups: CanvasSection[][] = []
    for (const ids of map) {
      const group = ids
        .map((id) => byId.get(id))
        .filter((s): s is CanvasSection => !!s && !covered.has(s.id))
      for (const s of group) covered.add(s.id)
      if (group.length > 0) groups.push(group)
    }
    // Content drift safety: anything staged but unmapped joins trailing runs
    // (last group when it has room, else its own balanced chunks) so grouping
    // stays lossless without editing the map for every copy tweak.
    const rest = staged.filter((s) => !covered.has(s.id))
    if (rest.length > 0) {
      const last = groups[groups.length - 1]
      if (last && last.length + rest.length <= 4) last.push(...rest)
      else for (let i = 0; i < rest.length; i += 4) groups.push(rest.slice(i, i + 4))
    }
    if (groups.length > 0) return { groups, tail }
  }

  // Fallback (non-guide keys): balanced 2-4 stage chunks.
  const groupCount = Math.max(1, Math.ceil(staged.length / 4))
  const base = Math.floor(staged.length / groupCount)
  const extra = staged.length % groupCount
  const groups: CanvasSection[][] = []
  let at = 0
  for (let g = 0; g < groupCount; g++) {
    const size = base + (g < extra ? 1 : 0)
    groups.push(staged.slice(at, at + size))
    at += size
  }
  return { groups, tail }
}

/** Stage count per group is fixed by grouping; each stage owns an equal,
 *  half-open slice of the track: stage i = [i/n, (i+1)/n). */
export function guideStages(sections: CanvasSection[]): ScrollStage[] {
  const n = Math.max(1, sections.length)
  return sections.map((s, i) => ({ id: s.id, range: [i / n, (i + 1) / n] as [number, number] }))
}
