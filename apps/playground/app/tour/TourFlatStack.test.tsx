/**
 * TourFlatStack.test.tsx — reduced-motion flat-card layout assertions.
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'
import type { TourFlatStackProps } from './TourFlatStack'
import type { ScriptBlock } from '@/components/Editor/types'

// ── Heavy dependencies ───────────────────────────────────────────────────────

mock.module('@/components/organisms/editor/NoteEditor', () => ({
  NoteEditor: (props: {
    value?: string
    onChange?: (value: string) => void
    onBlocksChange?: (blocks: ScriptBlock[]) => void
  }) => {
    const React = require('react')
    React.useEffect(() => {
      props.onBlocksChange?.([{ id: 'block-1', type: 'Timer' } as unknown as ScriptBlock])
    }, [])
    return (
      <textarea
        data-testid="mock-note-editor"
        value={props.value ?? ''}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(e.target.value)}
      />
    )
  },
}))


import { TourFlatStack } from './TourFlatStack'

// ── Test data ────────────────────────────────────────────────────────────────

const baseProps = {
  theme: 'light',
  doc: 'AMRAP 10\n  10 Pull-ups\n',
  onDocChange: () => {},
  onBlocksChange: () => {},
  onRun: () => {},
  exampleDoc: 'AMRAP 5\n  5 Pull-ups\n',
  onExampleDocChange: () => {},
  onExampleBlocksChange: () => {},
  timer: {
    sessionKey: 0,
    block: null,
    autoStart: false,
    onClose: () => {},
    onComplete: () => {},
    onRuntimeReady: () => {},
    onReset: () => {},
  },
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TourFlatStack', () => {
  let recorded: Array<{ name: string; payload?: Record<string, unknown> }> = []
  let unsubscribe: () => void = () => {}

  beforeEach(() => {
    recorded = []
    unsubscribe = telemetry.events.subscribe((event) => recorded.push(event))
  })

  afterEach(() => {
    unsubscribe()
    cleanup()
  })

  async function renderStack(props: Partial<TourFlatStackProps> = {}) {
    const result = render(
      <MemoryRouter>
        <TourFlatStack {...baseProps} {...props} />
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    return result
  }

  it('renders exactly one behaviors link in the timer card', async () => {
    await renderStack()

    const card = screen.getByTestId('tour-timer-card')
    expect(card).toBeTruthy()

    const links = screen.getAllByRole('link', { name: /Read the behaviors explainer/i })
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('href')).toBe('/guide/clock#run-next')
  })

  it('records the correct telemetry event from the timer card drop-off', async () => {
    await renderStack()

    const link = screen.getByRole('link', { name: /Read the behaviors explainer/i })
    link.click()
    expect(recorded.map((e) => e.name)).toContain(HOME_EVENTS.behaviorsOpened)
  })

})
