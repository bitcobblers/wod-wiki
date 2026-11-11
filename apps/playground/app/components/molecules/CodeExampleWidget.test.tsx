import { afterEach, describe, expect, it } from 'bun:test'
// React 19 only flushes updates inside act() when the test environment opts
// in; the historical full-suite run got this from a sibling file's global.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { CodeExampleWidget, type CodeExampleWidgetConfig } from './CodeExampleWidget'

// Real CodeMirror 6 in jsdom — same measure polyfills as the NoteEditor suites
// (scrollIntoView schedules a CM6 measure pass that reads text rects).
const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
(window.Range.prototype as any).getClientRects ??= () => [];
(window.Range.prototype as any).getBoundingClientRect ??= () => zeroRect;
(window.Element.prototype as any).getClientRects ??= () => [];

const validConfig: CodeExampleWidgetConfig = {
  lines: [
    { code: '20:00 AMRAP', annotation: 'Classic AMRAP from the guide.' },
    { code: '  5 Pullups', annotation: 'Start each round with pullups.' },
  ],
  cta: 'Run this example',
}

afterEach(() => {
  cleanup()
})

describe('CodeExampleWidget', () => {
  it('renders configured lines and forwards runnable script on CTA click', () => {
    const calls: string[] = []

    render(<CodeExampleWidget config={validConfig} isDarkMode={false} onRun={(script) => calls.push(script)} />)

    expect(screen.getByRole('heading', { name: /code example/i })).toBeTruthy()
    expect(screen.getByText(/classic amrap from the guide/i)).toBeTruthy()
    expect(screen.getByText(/start each round with pullups/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /run this example/i }))

    expect(calls).toEqual(['20:00 AMRAP\n  5 Pullups'])
  })

  it('renders an invalid-config warning when no lines are provided', () => {
    render(
      <CodeExampleWidget
        config={{ lines: [], cta: 'Run this example' }}
        isDarkMode={false}
        onRun={() => {}}
      />,
    )

    expect(screen.getByText(/invalid/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run this example/i })).toBeNull()
  })
})
