import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CanvasProse } from '../../app/canvas/CanvasProse'

describe('home feature markdown rendering', () => {
  it('renders analytics labels as bold prefixes with their labels intact', () => {
    const testProse = [
      '- **Pre:** estimated time, total reps, projected volume',
      '- **Post:** actual vs. estimated, intensity graph, per-block breakdown'
    ].join('\n')

    const html = renderToStaticMarkup(
      <CanvasProse prose={testProse} />,
    )

    expect(html).toContain('<strong class="font-black text-foreground">Pre:</strong>')
    expect(html).toContain('estimated time, total reps, projected volume')
    expect(html).toContain('<strong class="font-black text-foreground">Post:</strong>')
    expect(html).toContain('actual vs. estimated, intensity graph, per-block breakdown')
    expect(html).not.toContain('**Pre:**')
    expect(html).not.toContain('**Post:**')
  })
})
