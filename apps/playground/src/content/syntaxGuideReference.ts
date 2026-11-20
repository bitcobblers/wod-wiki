/**
 * syntaxGuideReference — pure derivation of the landing-page guide snippets
 * from the seeded corpus (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * The guide examples live in canvas syntax pages (markdown/canvas/syntax/…);
 * the old `?raw` imports are gone — the raw markdown comes from the
 * seed-content snapshot. A missing page yields `undefined` for its reference
 * (the landing page falls back to placeholder copy).
 */
import type { SeedContentFiles } from '@/services/content/seedContent'

export interface SyntaxGuideReference {
  title: string
  subtitle: string
  docsPath: string
  workout: string
  storyContent: string
}

function readFrontmatterField(markdown: string, field: string) {
  const match = markdown.match(new RegExp(`^${field}:\\s*"([^"]+)"`, 'm'))

  if (!match?.[1]) {
    throw new Error(`Guide example is missing frontmatter field: ${field}`)
  }

  return match[1]
}

function extractWorkout(markdown: string) {
  const match = markdown.match(/```time\n([\s\S]*?)\n```/)

  if (!match) {
    throw new Error('Guide example is missing a ```time fenced block.')
  }

  return match[1]
}

function createReference(markdown: string, docsPath: string): SyntaxGuideReference {
  const title = readFrontmatterField(markdown, 'title')
  const subtitle = readFrontmatterField(markdown, 'subtitle')
  const workout = extractWorkout(markdown)

  return {
    title,
    subtitle,
    docsPath,
    workout,
    storyContent: ['# ' + title, '', subtitle, '', '```time', workout, '```'].join('\n'),
  }
}

/** Map of reference key → the canvas syntax page it derives from. */
const REFERENCE_SOURCES: Record<string, { path: string; docsPath: string }> = {
  coreRules: { path: 'markdown/canvas/syntax/core-rules.md', docsPath: '/page/guide-start?h=first-workout' },
  measurements: { path: 'markdown/canvas/syntax/measurements.md', docsPath: '/page/guide-start?h=measurements' },
  timerModifiers: { path: 'markdown/canvas/syntax/timer-modifiers.md', docsPath: '/page/guide-protocols?h=countdown-countup' },
  simpleRounds: { path: 'markdown/canvas/syntax/groups-1.md', docsPath: '/page/guide-structure?h=rounds' },
  repSchemes: { path: 'markdown/canvas/syntax/groups-2.md', docsPath: '/page/guide-structure?h=rep-schemes' },
  timersAndRest: { path: 'markdown/canvas/syntax/timers-rest.md', docsPath: '/page/guide-protocols?h=required-rest' },
  classicAmrap: { path: 'markdown/canvas/syntax/classic-amrap.md', docsPath: '/page/guide-protocols?h=amrap' },
  basicEmom: { path: 'markdown/canvas/syntax/basic-emom.md', docsPath: '/page/guide-protocols?h=emom' },
  standardTabata: { path: 'markdown/canvas/syntax/protocols-4.md', docsPath: '/page/guide-protocols?h=tabata-intervals' },
  mixedSections: { path: 'markdown/canvas/syntax/mixed-sections.md', docsPath: '/page/guide-structure?h=named-sections' },
  complexNestedProtocols: { path: 'markdown/canvas/syntax/complex-nested-protocols.md', docsPath: '/page/guide-sessions?h=nested' },
}

/**
 * Derive the guide references from the seeded corpus. Keys whose page is
 * missing (or malformed) are absent — consumers must fall back.
 */
export function buildSyntaxGuideReference(
  files: SeedContentFiles,
): Record<keyof typeof REFERENCE_SOURCES, SyntaxGuideReference | undefined> {
  const out: Record<string, SyntaxGuideReference | undefined> = {}
  for (const [key, { path, docsPath }] of Object.entries(REFERENCE_SOURCES)) {
    const markdown = files[path]
    if (!markdown) {
      out[key] = undefined
      continue
    }
    try {
      out[key] = createReference(markdown, docsPath)
    } catch {
      out[key] = undefined
    }
  }
  return out
}
