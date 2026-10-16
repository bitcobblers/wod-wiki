import { parseFrontmatter } from '@/lib/frontmatter'

/**
 * Canvas Markdown Parser
 *
 * Parses markdown files with `template: canvas` frontmatter and the
 * canvas DSL (view / command / button fenced blocks, heading attributes)
 * into a structured `ParsedCanvasPage` that `CanvasPage.tsx` renders.
 */

/** Where the runtime opens when set-state: track fires. */
export type OpenMode = 'view' | 'dialog' | 'route'

export interface ViewButton {
  label: string
  open?: OpenMode
  pipeline: PipelineStep[]
}

export interface ViewBlock {
  name: string
  state: string
  source: string
  runtime?: string
  launch?: string
  align: 'left' | 'right'
  width: string
  /** Buttons rendered directly on the sticky panel. */
  buttons: ViewButton[]
}

export interface PipelineStep {
  action: string
  value: string
}

export interface CommandBlock {
  target: string
  /** Where set-state:track opens the runtime. Default: 'dialog'. */
  open?: OpenMode
  pipeline: PipelineStep[]
}

export interface ButtonBlock {
  label: string
  target: string
  /** Where the runtime opens. Default: 'dialog'. */
  open?: OpenMode
  pipeline: PipelineStep[]
}

export interface ExampleBlock {
  label: string
  source: string
}

/** A piece of a section's body: either a markdown prose segment or an inline
 *  button that should render immediately after the preceding prose segment.
 *  The renderer concatenates chunks in order; buttons never appear in
 *  `section.prose`, which is a prose-only string for legacy consumers. */
export type SectionTheme = 'slate' | 'amber' | 'emerald' | 'sky' | 'violet' | 'rose'
export type SectionDensity = 'default' | 'compact'

export const SECTION_THEME_STYLES: Record<SectionTheme, { panel: string; accent: string; progress: string }> = {
  slate: {
    panel: 'border-slate-500/35 shadow-slate-500/12',
    accent: 'from-slate-500/70 via-slate-400/25 to-transparent',
    progress: 'from-slate-500 to-slate-400',
  },
  amber: {
    panel: 'border-amber-500/35 shadow-amber-500/12',
    accent: 'from-amber-500/75 via-amber-400/25 to-transparent',
    progress: 'from-amber-500 to-orange-400',
  },
  emerald: {
    panel: 'border-emerald-500/35 shadow-emerald-500/12',
    accent: 'from-emerald-500/75 via-emerald-400/25 to-transparent',
    progress: 'from-emerald-500 to-teal-400',
  },
  sky: {
    panel: 'border-sky-500/35 shadow-sky-500/12',
    accent: 'from-sky-500/75 via-sky-400/25 to-transparent',
    progress: 'from-sky-500 to-cyan-400',
  },
  violet: {
    panel: 'border-violet-500/35 shadow-violet-500/12',
    accent: 'from-violet-500/75 via-fuchsia-400/25 to-transparent',
    progress: 'from-violet-500 to-fuchsia-400',
  },
  rose: {
    panel: 'border-rose-500/35 shadow-rose-500/12',
    accent: 'from-rose-500/75 via-pink-400/25 to-transparent',
    progress: 'from-rose-500 to-pink-400',
  },
}

export type ProseChunk =
  | { kind: 'prose'; text: string }
  | { kind: 'button'; button: ButtonBlock }
  | { kind: 'widget'; widget: 'hero-carousel' | 'workouts-list' }
  | { kind: 'challenge'; id: string }

export interface CanvasSection {
  id: string
  heading: string
  level: number
  attrs: string[]         // e.g. ['sticky', 'dark', 'full-bleed', 'density:compact']
  theme?: SectionTheme
  density?: SectionDensity
  isDark?: boolean
  isFullBleed?: boolean
  isSticky?: boolean
  /** Prose-only body. Derived from proseChunks; present on parser-built sections. */
  prose?: string
  /** Ordered, fence-aware body: prose segments interleaved with buttons so
   *  each button renders after the paragraph it was defined under. */
  proseChunks: ProseChunk[]
  view?: ViewBlock
  commands: CommandBlock[]
  buttons: ButtonBlock[]
  examples?: ExampleBlock[]
}


/**
 * Derive the flat prose string from a section's ordered chunks.
 * Concatenates all `prose` chunks in order — the inverse of the
 * parser's prose→chunks pass. Returns '' for sections with no prose chunks.
 */
export function getSectionProse(section: CanvasSection): string {
  return section.proseChunks
    .filter((c): c is { kind: 'prose'; text: string } => c.kind === 'prose')
    .map(c => c.text)
    .join('')
}
export interface ParsedCanvasPage {
  frontmatter: Record<string, any>
  template: string
  route: string
  /** Frontmatter `type` (e.g. 'guide') — surfaced for page-kind gating. */
  type?: string
  sections: CanvasSection[]
  /**
   * Page-level quests, extracted from ```quest fenced blocks that appear
   * before the first section heading. Each entry is consumed by
   * `useSyntaxChallenge` to validate the page's compiled editor block.
   */
  quests: Quest[]
  /**
   * Page-level chapters, extracted from ```chapter fenced blocks.
   * Chapters are a visual grouping layer that the OnboardingBanner
   * reads to show progressive-completion badges. Their `questIds` may
   * reference quests on OTHER pages (cross-route completion is read
   * directly from the localStorage ledger).
   */
  chapters: Chapter[]
  /**
   * Page-level scroll-runway spec, extracted from a ```scroll fenced
   * block (page-wide, stripped before section splitting). `null` when the
   * page declares none (or the block is malformed) — the page then
   * renders as a normal MarkdownCanvasPage.
   */
  scroll?: ScrollSpec | null
  /** Named ```scroll:<name> runways (e.g. a chapter tour) parsed from the page. */
  namedScrolls?: Record<string, ScrollSpec>
}

/** Map each challenge id to the id of the section that contains its
 *  `{{challenge:<id>}}` directive. Used by the header badge dropdown to
 *  scroll to the relevant section when a challenge is selected. */
export function getChallengeSectionMap(page: ParsedCanvasPage): Map<string, string> {
  const map = new Map<string, string>()
  for (const section of page.sections) {
    for (const chunk of section.proseChunks) {
      if (chunk.kind === 'challenge') {
        map.set(chunk.id, section.id)
      }
    }
  }
  return map
}

/** Page-level quest — same shape as the validator's `Quest.validation` so
 *  `useSyntaxChallenge` can pass it through unchanged. */
export interface Quest {
  id: string
  label: string
  desc?: string
  validation?: { type: string; [key: string]: unknown }
}

/** Optional per-stage parallax escape hatch: maps an element carrying
 *  `data-effect-target="<target>"` through an opacity/translateY window
 *  driven by the active stage's local progress. */
export interface ScrollEffect {
  /** Matches data-effect-target="<target>" on a descendant of the runway. */
  target: string
  /** Stage ids this effect applies to. */
  stages: string[]
  /** from→to over local-t in the `in` window. */
  opacity?: [number, number]
  /** px, from→to over local-t in the `in` window. */
  translateY?: [number, number]
  /** default 'quad-out'. */
  ease?: 'linear' | 'quad-out'
  /** local-t window, default [0, 1]. */
  in?: [number, number]
}

/** One stage of a ```scroll runway — the markdown-DSL equivalent of the
 *  home tour's TourStage. */
export interface ScrollStage {
  id: string
  /** [start, end) runway progress, like TourStage. */
  range: [number, number]
  /** Screen visible during this stage ('editor' | 'timer' | 'analytics' | 'result'). */
  screen?: 'editor' | 'timer' | 'analytics' | 'result'
  /** Stage-bar label. */
  label?: string
  /** wods/examples path; resolved via resolveSource. */
  source?: string
  /** Prose for the cross-fading caption column. */
  caption?: string
  /** CSS color; default hsl(var(--foreground)). */
  accent?: string
  /** Highlight the editor or a target element this stage. `lines` focuses a
   *  1-based inclusive set of doc lines instead of the whole panel. */
  ring?: { key?: string; tag?: string; lines?: [number, number] } | true
  /** Transient message at stage open. */
  toast?: string
  /** Quest id fired on stage entry. */
  quest?: string
  /** Custom parallax on data-effect-target elements. */
  effects?: ScrollEffect[]
}

/** Parsed ```scroll fenced block — a page-level runway spec. */
export interface ScrollSpec {
  /** CSS height, e.g. '720vh'. Default '600vh'. */
  runway: string
  /** Only 'editor' supported in v1. */
  screen: 'editor'
  /** default true. */
  typewriter: boolean
  stages: ScrollStage[]
}

/** A chapter groups one or more home-page sections and references the
 *  quest ids whose completion unlocks the chapter badge. */
export interface Chapter {
  id: string
  title: string
  /** Lucide icon name — resolved by the renderer. */
  badge: string
  /** Quest ids (any page) whose completion contributes to this chapter. */
  questIds: string[]
  /** Section ids (on this page) that belong to this chapter, for visual grouping. */
  sectionIds: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseHeadingLine(line: string): { level: number; text: string; attrs: string[] } | null {
  const m = line.match(/^(#{1,6}) (.+)$/)
  if (!m) return null
  const level = m[1].length
  const raw = m[2]
  const attrMatch = raw.match(/\{([^}]+)\}$/)
  const attrs = attrMatch ? attrMatch[1].trim().split(/\s+/).filter(Boolean) : []
  const text = attrMatch ? raw.slice(0, attrMatch.index).trim() : raw.trim()
  return { level, text, attrs }
}

function parseKeyValue(lines: string[]): Record<string, string> {
  const kv: Record<string, string> = {}
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/)
    if (m) kv[m[1]] = m[2].trim()
  }
  return kv
}

function parsePipelineSteps(lines: string[]): PipelineStep[] {
  const steps: PipelineStep[] = []
  for (const line of lines) {
    // Matches:  - set-source: markdown/canvas/syntax/rest.md
    const m = line.match(/^\s*-\s+([\w-]+):\s+(.+)$/)
    if (m) steps.push({ action: m[1], value: m[2].trim() })
  }
  return steps
}

function parseViewBlock(content: string): ViewBlock {
  const lines = content.split('\n')
  const kv = parseKeyValue(lines)

  // Parse inline button lines: `button: Label | set-state: track | open: dialog`
  const buttons: ViewButton[] = []
  for (const line of lines) {
    const m = line.match(/^button:\s*(.+)$/)
    if (!m) continue
    const parts = m[1].split('|').map(p => p.trim())
    const label = parts[0] ?? 'Run'
    let open: OpenMode | undefined
    const pipelineParts: string[] = []
    for (const part of parts.slice(1)) {
      const openM = part.match(/^open:\s*(view|dialog|route)$/)
      if (openM) { open = openM[1] as OpenMode; continue }
      pipelineParts.push(`- ${part}`)
    }
    buttons.push({ label, open, pipeline: parsePipelineSteps(pipelineParts) })
  }

  return {
    name:    kv['name']    ?? 'view',
    state:   kv['state']   ?? 'note',
    source:  kv['source']  ?? '',
    runtime: kv['runtime'],
    launch:  kv['launch'],
    align:   (kv['align'] as 'left' | 'right') ?? 'right',
    width:   kv['width']   ?? '50%',
    buttons,
  }
}

function parseCommandBlock(content: string): CommandBlock {
  const lines = content.split('\n')
  let target = ''
  let open: OpenMode | undefined
  for (const line of lines) {
    const m = line.match(/^target:\s*(.+)$/)
    if (m) { target = m[1].trim(); continue }
    const openM = line.match(/^open:\s*(view|dialog|route)$/)
    if (openM) { open = openM[1] as OpenMode; continue }
  }
  return { target, open, pipeline: parsePipelineSteps(lines) }
}

function parseButtonBlock(content: string): ButtonBlock {
  const lines = content.split('\n')
  let label = 'Button'
  let target = ''
  let open: OpenMode | undefined
  for (const line of lines) {
    const labelM = line.match(/^label:\s*(.+)$/)
    if (labelM) { label = labelM[1].trim(); continue }
    const targetM = line.match(/^target:\s*(.+)$/)
    if (targetM) { target = targetM[1].trim(); continue }
    const openM = line.match(/^open:\s*(view|dialog|route)$/)
    if (openM) { open = openM[1] as OpenMode; continue }
  }
  return { label, target, open, pipeline: parsePipelineSteps(lines) }
}

function parseExampleBlock(content: string): ExampleBlock {
  const lines = content.split('\n')
  const kv = parseKeyValue(lines)
  return {
    label: kv['label'] ?? 'Example',
    source: kv['source'] ?? '',
  }
}


/**
 * Extract view / command / button fenced blocks from section text,
 * returning the remaining prose and parsed block objects.
 *
 * Regex: matches opening ```<type>\n ... closing ``` on its own line.
 * Only canvas DSL blocks (view/command/button) are excised from the prose;
 * all other fenced blocks (code, etc.) are kept so markdown renderers can
 * display them as styled code blocks.
 *
 * Returns `proseChunks` — an ordered list of prose segments and inline
 * buttons — so the renderer can place each button after the paragraph it
 * was authored under. `prose` is the legacy concatenation of the prose
 * segments only.
 */

/** Parse the inner content of a single ```quest fenced block. Returns
 *  `null` when the block is missing the required `id` field. */
function parseQuestBlock(content: string): Quest | null {
  const meta: Record<string, string> = {};
  const validation: Record<string, string> = {};
  let inValidation = false;
  for (const raw of content.split('\n')) {
    // Strip leading whitespace so indented sub-fields (e.g. inside
    // `validation:`) match the field regex.
    const line = raw.trim();
    if (line === '') continue;
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'validation') {
      inValidation = true;
      continue;
    }
    if (inValidation) validation[key] = value;
    else meta[key] = value;
  }
  if (!meta.id) return null;
  const q: Quest = { id: meta.id, label: meta.label ?? meta.id };
  if (meta.desc) q.desc = meta.desc;
  if (Object.keys(validation).length > 0) {
    // Coerce numeric fields (e.g. `count: 3` → `3` instead of `"3"`) so
    // validator schemas like `min-rounds` work without extra parsing.
    const v: Record<string, unknown> = { ...validation };
    for (const k of Object.keys(v)) {
      const num = Number(v[k]);
      if (v[k] !== '' && !isNaN(num) && String(num) === v[k]) v[k] = num;
    }
    q.validation = v as Quest['validation'];
  }
  return q;
}

/** Strip page-level ```quest fenced blocks from the body. The block
 *  text is always removed from the body so it doesn't bleed into section
 *  parsing or prose rendering, but the parsed quest is collected
 *  regardless of where the block sits (pre-heading or in-section) so
 *  authors can place quests in the section that introduces them. */
function extractPageQuests(body: string): { quests: Quest[]; body: string } {
  const lines = body.split('\n');
  const quests: Quest[] = [];
  const out: string[] = [];
  let inFence = false;
  let buffer: string[] = [];
  const flushFence = () => {
    const q = parseQuestBlock(buffer.join('\n'));
    if (q) quests.push(q);
    buffer = [];
  };
  for (const line of lines) {
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        flushFence();
        inFence = false;
      } else {
        buffer.push(line);
      }
      continue;
    }
    const fenceMatch = line.match(/^```(\w+)\s*$/);
    if (fenceMatch) {
      if (fenceMatch[1] === 'quest') {
        inFence = true;
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  if (inFence) flushFence();
  return { quests, body: out.join('\n') };
}

/** Parse the inner content of a single ```chapter fenced block. Returns
 *  `null` when the block is missing the required `id` or `title` field. */
function parseChapterBlock(content: string): Chapter | null {
  const meta: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  if (!meta.id || !meta.title) return null;
  const c: Chapter = {
    id: meta.id,
    title: meta.title,
    badge: meta.badge || 'trophy',
    questIds: parseIdList(meta.quests),
    sectionIds: parseIdList(meta.sections),
  };
  return c;
}

/** Parse a comma- or whitespace-separated list of ids from a flat field
 *  value, tolerating `[bracket]` syntax. Empty / null returns []. */
function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  const stripped = raw.replace(/^\[|\]$/g, '').trim();
  if (!stripped) return [];
  return stripped
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip page-level ```chapter fenced blocks from the body. Page-wide
 *  scope (same as ```quest). The block text is removed so it doesn't
 *  bleed into section parsing. */
function extractPageChapters(body: string): { chapters: Chapter[]; body: string } {
  const lines = body.split('\n');
  const chapters: Chapter[] = [];
  const out: string[] = [];
  let inFence = false;
  let buffer: string[] = [];
  const flushFence = () => {
    const c = parseChapterBlock(buffer.join('\n'));
    if (c) chapters.push(c);
    buffer = [];
  };
  for (const line of lines) {
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        flushFence();
        inFence = false;
      } else {
        buffer.push(line);
      }
      continue;
    }
    const fenceMatch = line.match(/^```(\w+)\s*$/);
    if (fenceMatch) {
      if (fenceMatch[1] === 'chapter') {
        inFence = true;
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  if (inFence) flushFence();
  return { chapters, body: out.join('\n') };
}

/** Parse a JSON-style `[a, b]` pair of numbers. Undefined when malformed. */
function parseNumberPair(raw: string): [number, number] | undefined {
  const m = raw.match(/^\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]$/)
  if (!m) return undefined
  return [Number(m[1]), Number(m[2])]
}

/** Strip surrounding quotes from a flat field value. */
function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

/** Parse the `stages:` list region of a ```scroll block — the one
 *  indentation-aware list-of-objects parser in the DSL. Each `- id: …`
 *  item consumes its deeper-indented `key: value` lines; `ring:` and
 *  `effects:` open one more nesting level (modeled on the `validation:`
 *  nesting in parseQuestBlock and the list walk in parsePipelineSteps). */
function parseScrollStages(lines: string[]): ScrollStage[] {
  const stages: ScrollStage[] = []
  let stageIndent = -1
  let cur: ScrollStage | null = null
  let nested: 'ring' | 'effects' | null = null
  let curEffect: ScrollEffect | null = null

  for (const raw of lines) {
    if (raw.trim() === '') continue
    const indent = raw.match(/^\s*/)![0].length
    const line = raw.trim()
    const item = line.match(/^-\s+([\w-]+):\s*(.*)$/)

    if (item && (nested !== 'effects' || indent <= stageIndent)) {
      // New stage item.
      if (stageIndent === -1) stageIndent = indent
      cur = { id: unquote(item[2]), range: [0, 1] }
      stages.push(cur)
      nested = null
      curEffect = null
      continue
    }
    if (item && nested === 'effects' && cur) {
      // New effect item under `effects:`.
      curEffect = { target: unquote(item[2]), stages: cur.id ? [cur.id] : [] }
      ;(cur.effects ??= []).push(curEffect)
      continue
    }

    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv || !cur) continue
    const key = kv[1]
    const value = kv[2].trim()

    if (nested === 'ring') {
      if (cur.ring && cur.ring !== true) {
        if (key === 'tag') cur.ring.tag = unquote(value)
        if (key === 'key') cur.ring.key = unquote(value)
        if (key === 'lines') {
          const pair = parseNumberPair(value)
          if (pair) {
            const a = Math.max(1, Math.round(pair[0]))
            const b = Math.max(1, Math.round(pair[1]))
            cur.ring.lines = [Math.min(a, b), Math.max(a, b)]
          }
        }
      }
      continue
    }
    if (nested === 'effects' && curEffect) {
      switch (key) {
        case 'target': curEffect.target = unquote(value); break
        case 'stages': curEffect.stages = parseIdList(value); break
        case 'opacity': curEffect.opacity = parseNumberPair(value); break
        case 'translateY': curEffect.translateY = parseNumberPair(value); break
        case 'ease':
          if (value === 'linear' || value === 'quad-out') curEffect.ease = value
          break
        case 'in': curEffect.in = parseNumberPair(value); break
      }
      continue
    }

    switch (key) {
      case 'range': {
        const pair = parseNumberPair(value)
        if (pair) cur.range = pair
        break
      }
      case 'screen':
        if (value === 'editor' || value === 'timer' || value === 'analytics' || value === 'result') cur.screen = value
        break
      case 'label': cur.label = unquote(value); break
      case 'source': cur.source = unquote(value); break
      case 'caption': cur.caption = unquote(value); break
      case 'accent': cur.accent = unquote(value); break
      case 'toast': cur.toast = unquote(value); break
      case 'quest': cur.quest = unquote(value); break
      case 'ring':
        if (value === '' ) {
          cur.ring = {}
          nested = 'ring'
        } else if (value === 'true') {
          cur.ring = true
        }
        break
      case 'effects':
        cur.effects = []
        curEffect = null
        nested = 'effects'
        break
    }
  }
  return stages
}

/** Parse the inner content of a ```scroll fenced block. Returns `null`
 *  when the block has no stages — a runway without stages is meaningless,
 *  so the page falls back to a normal canvas render. Never throws. */
function parseScrollBlock(content: string): ScrollSpec | null {
  try {
    const lines = content.split('\n')
    const stagesIdx = lines.findIndex((l) => /^\s*stages:\s*$/.test(l))
    const flat = parseKeyValue(stagesIdx === -1 ? lines : lines.slice(0, stagesIdx))
    const stages = stagesIdx === -1 ? [] : parseScrollStages(lines.slice(stagesIdx + 1))
    if (stages.length === 0) return null
    return {
      runway: flat['runway'] ?? '600vh',
      screen: 'editor',
      typewriter: flat['typewriter'] !== 'false',
      stages,
    }
  } catch (err) {
    console.warn('[canvas] malformed ```scroll block:', err)
    return null
  }
}

/** Strip page-level ```scroll fenced blocks from the body. Page-wide
 *  scope (same as ```quest / ```chapter). The first unnamed block becomes
 *  `page.scroll`; any named blocks (```scroll:<name>) are captured into
 *  `namedScrolls` so a page can declare multiple runways (e.g. a hero
 *  runway + a chapter runway). Every block is removed from the body so it
 *  doesn't bleed into section parsing. Malformed → console.warn + skipped. */
function extractPageScroll(body: string): { scroll: ScrollSpec | null; namedScrolls: Record<string, ScrollSpec>; body: string } {
  const lines = body.split('\n');
  let scroll: ScrollSpec | null = null;
  const namedScrolls: Record<string, ScrollSpec> = {};
  const out: string[] = [];
  let inFence = false;
  let fenceName: string | null = null;
  let buffer: string[] = [];
  const flushFence = () => {
    const spec = parseScrollBlock(buffer.join('\n'));
    if (spec) {
      if (fenceName) {
        if (namedScrolls[fenceName]) console.warn(`[canvas] duplicate named \`\`\`scroll:${fenceName} block ignored`);
        else namedScrolls[fenceName] = spec;
      } else if (scroll === null) scroll = spec;
      else console.warn('[canvas] duplicate unnamed ```scroll block ignored');
    } else {
      console.warn('[canvas] ```scroll block ignored: missing or malformed stages');
    }
    buffer = [];
    fenceName = null;
  };
  for (const line of lines) {
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        flushFence();
        inFence = false;
      } else {
        buffer.push(line);
      }
      continue;
    }
    const fenceMatch = line.match(/^```scroll(?::([\w-]+))?\s*$/);
    if (fenceMatch) {
      inFence = true;
      fenceName = fenceMatch[1] ?? null;
      continue;
    }
    out.push(line);
  }
  if (inFence) flushFence();
  return { scroll, namedScrolls, body: out.join('\n') };
}

function splitProseForWidgets(text: string): ProseChunk[] {
  if (!text) return []
  const tokens = [
    { token: '{{hero-carousel}}', widget: 'hero-carousel' as const },
  ]

  let chunks: ProseChunk[] = [{ kind: 'prose', text }]

  for (const { token, widget } of tokens) {
    const nextChunks: ProseChunk[] = []
    for (const chunk of chunks) {
      if (chunk.kind !== 'prose') {
        nextChunks.push(chunk)
        continue
      }
      const parts = chunk.text.split(token)
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          nextChunks.push({ kind: 'widget', widget })
        }
        nextChunks.push({ kind: 'prose', text: parts[i] })
      }
    }
    chunks = nextChunks
  }

  // Challenge directive: {{challenge:<id>}} — rendered inline inside the
  // section that authors it, rather than as a page-bottom list.
  const challengeRe = /\{\{challenge:([^}]+)\}\}/g
  const afterChallenge: ProseChunk[] = []
  for (const chunk of chunks) {
    if (chunk.kind !== 'prose') {
      afterChallenge.push(chunk)
      continue
    }
    const text = chunk.text
    let lastIndex = 0
    let match: RegExpExecArray | null
    challengeRe.lastIndex = 0
    while ((match = challengeRe.exec(text)) !== null) {
      afterChallenge.push({ kind: 'prose', text: text.slice(lastIndex, match.index) })
      afterChallenge.push({ kind: 'challenge', id: match[1].trim() })
      lastIndex = match.index + match[0].length
    }
    afterChallenge.push({ kind: 'prose', text: text.slice(lastIndex) })
  }
  chunks = afterChallenge

  return chunks.filter((c) => c.kind !== 'prose' || c.text !== '')
}
function extractBlocks(text: string): {
  proseChunks: ProseChunk[]
  view?: ViewBlock
  commands: CommandBlock[]
  buttons: ButtonBlock[]
  examples: ExampleBlock[]
} {
  // NOTE: the backtick sequences in these strings intentionally delimit fenced
  // blocks in the DSL — they are NOT nested markdown fences.
  const fenceRe = /^```(\w+)\n([\s\S]*?)^```[ \t]*$/gm
  const fences: Array<{ start: number; end: number; type: string; content: string }> = []

  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(text)) !== null) {
    fences.push({
      start:   match.index,
      end:     match.index + match[0].length,
      type:    match[1],
      content: match[2],
    })
  }

  // Parse each fence into its block object, in source order, and remember
  // the parsed `ButtonBlock` for the inline chunk list. We keep a parallel
  // cursor so the chunk list can interleave prose segments with the
  // specific `button` fences that authored them.
  let view: ViewBlock | undefined
  const commands: CommandBlock[] = []
  const buttons: ButtonBlock[] = []
  const examples: ExampleBlock[] = []
  // `buttonByFenceIdx[i]` holds the ButtonBlock parsed from `fences[i]`,
  // or `null` for non-button fences. Fences are visited in source order.
  const buttonByFenceIdx: Array<ButtonBlock | null> = []

  for (let i = 0; i < fences.length; i++) {
    const { type, content } = fences[i]
    if (type === 'view') {
      view = parseViewBlock(content)
      buttonByFenceIdx.push(null)
    } else if (type === 'command') {
      commands.push(parseCommandBlock(content))
      buttonByFenceIdx.push(null)
    } else if (type === 'button') {
      const btn = parseButtonBlock(content)
      buttons.push(btn)
      buttonByFenceIdx.push(btn)
    } else if (type === 'example') {
      examples.push(parseExampleBlock(content))
      buttonByFenceIdx.push(null)
    } else {
      buttonByFenceIdx.push(null)
    }
  }

  // Walk the source text once more, slicing the prose and interleaving
  // button chunks at the position each `button` fence was authored. The
  // `view`/`command`/`example` fences are anchor/trigger blocks only — they
  // drive the sticky panel but have no prose representation of their own —
  // so they're excised from the prose entirely, same as `button`. Any other
  // fence type (e.g. a `wod` code sample) is left untouched so it renders as
  // a normal fenced code block.
  const invisibleFenceTypes = new Set(['view', 'command', 'example'])
  const proseChunks: ProseChunk[] = []
  let pos = 0
  for (let i = 0; i < fences.length; i++) {
    const fence = fences[i]
    const button = buttonByFenceIdx[i]
    if (button) {
      proseChunks.push(...splitProseForWidgets(text.slice(pos, fence.start)))
      proseChunks.push({ kind: 'button', button })
      pos = fence.end
    } else if (invisibleFenceTypes.has(fence.type)) {
      proseChunks.push(...splitProseForWidgets(text.slice(pos, fence.start)))
      pos = fence.end
    }
  }
  proseChunks.push(...splitProseForWidgets(text.slice(pos)))

  return { proseChunks, view, commands, buttons, examples }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseCanvasMarkdown(raw: string, defaultRoute: string = '/'): ParsedCanvasPage | null {
  const { meta, body } = parseFrontmatter(raw)
  if (String(meta['template'] ?? '') !== 'canvas') return null

  // Pull page-level quest and chapter blocks out of the body before
  // section splitting. Both are page-wide (collect+strip every block).
  const { quests, body: bodyWithoutQuests } = extractPageQuests(body)
  const { scroll, namedScrolls, body: bodyWithoutScroll } = extractPageScroll(bodyWithoutQuests)
  const { chapters } = extractPageChapters(bodyWithoutScroll)

  const route = String(meta['route'] ?? defaultRoute)
  const sections: CanvasSection[] = []

  type Acc = { heading: string; level: number; attrs: string[]; lines: string[] }
  let cur: Acc | null = null

  const flush = (acc: Acc) => {
    const { proseChunks, view, commands, buttons, examples } = extractBlocks(acc.lines.join('\n'))

    // Support explicit ID in attributes (e.g. {#statement})
    const explicitId = acc.attrs.find(a => a.startsWith('#'))?.slice(1)
    const cleanAttrs = acc.attrs.filter(a => !a.startsWith('#'))
    const hasAttr = (a: string) => cleanAttrs.includes(a)
    const getAttrValue = (key: string) =>
      cleanAttrs.find(attr => attr.startsWith(`${key}:`))?.slice(key.length + 1)

    sections.push({
      id:          explicitId || slugify(acc.heading) || `section-${sections.length}`,
      heading:     acc.heading,
      level:       acc.level,
      attrs:       cleanAttrs,
      theme:       (getAttrValue('theme') ?? 'slate') as any,
      density:     (getAttrValue('density') ?? 'default') as any,
      isDark:      hasAttr('dark'),
      isFullBleed: hasAttr('full-bleed'),
      isSticky:    hasAttr('sticky'),
      prose:       getSectionProse({ proseChunks } as any),
      proseChunks,
      view,
      commands,
      buttons,
      examples,
    })
  }

  let inFence = false
  for (const line of bodyWithoutScroll.split('\n')) {
    // Headings inside a fenced block (e.g. the `## Widget` headings inside a
    // ````markdown dashboard example) are content, not section boundaries.
    if (/^`{3,}/.test(line)) inFence = !inFence
    const h = inFence ? null : parseHeadingLine(line)
    if (h) {
      if (cur) flush(cur)
      cur = { heading: h.text, level: h.level, attrs: h.attrs, lines: [] }
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  if (cur) flush(cur)

  return { template: 'canvas', route, type: meta['type'] ? String(meta['type']) : undefined, sections, frontmatter: meta, quests, chapters, scroll, namedScrolls }
}
