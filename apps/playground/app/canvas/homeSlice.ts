import homeMarkdown from '../../../../markdown/canvas/home/README.md?raw'
import welcomeMarkdown from '../../../../markdown/canvas/home/welcome-1.md?raw'
import singleMovementMarkdown from '../../../../markdown/canvas/syntax/single-movement.md?raw'
import timersRestMarkdown from '../../../../markdown/canvas/syntax/timers-rest.md?raw'
import groupsMarkdown from '../../../../markdown/canvas/syntax/groups-1.md?raw'
import customMetricsMarkdown from '../../../../markdown/canvas/syntax/custom-metrics-1.md?raw'
import dialectClimbMarkdown from '../../../../markdown/canvas/syntax/dialect-climb-bouldering.md?raw'
import complexSwimmingMarkdown from '../../../../markdown/canvas/syntax/complex-swimming.md?raw'

import { parseCanvasMarkdown, type ParsedCanvasPage } from './parseCanvasMarkdown'

const parsedHomePage = parseCanvasMarkdown(homeMarkdown)
if (!parsedHomePage) {
  throw new Error('The baked home page must remain a valid canvas document')
}

/** The bundle-owned home page, available before the seed corpus is imported. */
export const HOME_PAGE: ParsedCanvasPage = parsedHomePage

/** Raw corpus-shaped documents referenced by the home page and its chapters. */
export const HOME_DOCS = {
  'markdown/canvas/home/welcome-1.md': welcomeMarkdown,
  'markdown/canvas/syntax/single-movement.md': singleMovementMarkdown,
  'markdown/canvas/syntax/timers-rest.md': timersRestMarkdown,
  'markdown/canvas/syntax/groups-1.md': groupsMarkdown,
  'markdown/canvas/syntax/custom-metrics-1.md': customMetricsMarkdown,
  'markdown/canvas/syntax/dialect-climb-bouldering.md': dialectClimbMarkdown,
  'markdown/canvas/syntax/complex-swimming.md': complexSwimmingMarkdown,
} satisfies Record<string, string>

/** Corpus-shaped documents with the bundle-owned home slice as the baseline. */
export function withHomeDocs(files: Record<string, string>): Record<string, string> {
  return { ...HOME_DOCS, ...files }
}
