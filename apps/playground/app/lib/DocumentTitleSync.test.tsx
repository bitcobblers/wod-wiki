import { describe, it, expect, beforeEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { DocumentTitleSync } from './DocumentTitleSync'

function NavigateButton({ to, children }: { to: string; children: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      {children}
    </button>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} initialIndex={0}>
      <DocumentTitleSync />
      <NavigateButton to="/day/2026-01-01">Go Day</NavigateButton>
      <NavigateButton to="/effort/push-up">Go Effort</NavigateButton>
      <NavigateButton to="/playground/abc">Go Playground</NavigateButton>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  cleanup()
  document.title = 'Test Setup Title'
})

describe('DocumentTitleSync', () => {
  it('sets the default title for unmapped routes', () => {
    renderAt('/some-unknown-page')
    expect(document.title).toBe('Wod.Wiki')
  })

  it('sets the base title for /journal deep detail routes', () => {
    renderAt('/journal')
    expect(document.title).toBe('Wod.Wiki - Journal')
  })

  it('sets the base title for /day/:date routes — the title names the Day concept', () => {
    renderAt('/day/2026-05-12')
    expect(document.title).toBe('Wod.Wiki - Day')
  })

  it('sets the base title for /feed deep detail routes — the title names the Feed concept', () => {
    renderAt('/feed/daily-wod')
    expect(document.title).toBe('Wod.Wiki - Feed')
  })

  it('sets the base title for /notebook deep detail routes', () => {
    renderAt('/notebook/cardio')
    expect(document.title).toBe('Wod.Wiki - Notebooks')
  })

  it('sets the base title for /note deep detail routes', () => {
    renderAt('/note/550e8400-e29b-41d4-a716-446655440000')
    expect(document.title).toBe('Wod.Wiki - Note')
  })

  it('derives stream titles from the profile registry', () => {
    renderAt('/notebooks')
    expect(document.title).toBe('Wod.Wiki - Notebooks')

    renderAt('/notes')
    expect(document.title).toBe('Wod.Wiki - Notes')

    renderAt('/feeds')
    expect(document.title).toBe('Wod.Wiki - Feeds')

    renderAt('/pages')
    expect(document.title).toBe('Wod.Wiki - Pages')

    renderAt('/sessions')
    expect(document.title).toBe('Wod.Wiki - Sessions')

    renderAt('/session/2026-09-17')
    expect(document.title).toBe('Wod.Wiki - Sessions')

    renderAt('/playgrounds')
    expect(document.title).toBe('Wod.Wiki - Playgrounds')

    renderAt('/dashboards')
    expect(document.title).toBe('Wod.Wiki - Dashboards')

    renderAt('/dashboard/strength-trends')
    expect(document.title).toBe('Wod.Wiki - Dashboards')
  })

  it('sets the base title for efforts list route', () => {
    renderAt('/efforts')
    expect(document.title).toBe('Wod.Wiki - Efforts')
  })

  it('sets the base title for the tags routes', () => {
    renderAt('/tags')
    expect(document.title).toBe('Wod.Wiki - Tags')

    cleanup()
    document.title = 'Test Setup Title'
    renderAt('/t/domain/running')
    expect(document.title).toBe('Wod.Wiki - Tags')
  })

  it('does not override the title for /effort/:slug', () => {
    renderAt('/effort/push-up')
    expect(document.title).toBe('Test Setup Title')
  })

  it('does not override the title for /playground/:id', () => {
    renderAt('/playground/abc')
    expect(document.title).toBe('Test Setup Title')
  })

  it('updates title on navigation and leaves exempt routes unchanged', () => {
    const { unmount: u1 } = renderAt('/notebooks')
    expect(document.title).toBe('Wod.Wiki - Notebooks')
    u1()

    const { unmount: u2 } = renderAt('/day/2026-01-01')
    expect(document.title).toBe('Wod.Wiki - Day')
    u2()

    const { unmount: u3 } = renderAt('/effort/push-up')
    expect(document.title).toBe('Wod.Wiki - Day')
    u3()

    renderAt('/playground/abc')
    expect(document.title).toBe('Wod.Wiki - Day')
  })
})
