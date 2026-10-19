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
      <NavigateButton to="/journal/2026-01-01">Go Journal</NavigateButton>
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

  it('sets the base title for /journal deep detail routes (Journal is the legacy page)', () => {
    renderAt('/journal/2026-05-12')
    expect(document.title).toBe('Wod.Wiki - Journal')
  })

  it('sets the base title for /feeds deep detail routes', () => {
    renderAt('/feeds/daily-wod')
    expect(document.title).toBe('Wod.Wiki - Notes')
  })

  it('sets the base title for /collections deep detail routes', () => {
    renderAt('/collections/cardio')
    expect(document.title).toBe('Wod.Wiki - Notes')
  })

  it('derives rebranded stream titles from the profile registry', () => {
    renderAt('/c/dan-john')
    expect(document.title).toBe('Wod.Wiki - Notes')

    renderAt('/sessions')
    expect(document.title).toBe('Wod.Wiki - Sessions')

    renderAt('/session/2026-09-17')
    expect(document.title).toBe('Wod.Wiki - Sessions')

    renderAt('/playgrounds')
    expect(document.title).toBe('Wod.Wiki - Playgrounds')

    renderAt('/dashboards')
    expect(document.title).toBe('Wod.Wiki - Dashboards')

    renderAt('/d/strength-trends')
    expect(document.title).toBe('Wod.Wiki - Dashboards')
  })

  it('sets the base title for efforts list route', () => {
    renderAt('/efforts')
    expect(document.title).toBe('Wod.Wiki - Efforts')
  })

  it('sets the base title for analytics routes', () => {
    renderAt('/analytics')
    expect(document.title).toBe('Wod.Wiki - Analytics')

    cleanup()
    document.title = 'Test Setup Title'
    renderAt('/analytics/dashboard')
    expect(document.title).toBe('Wod.Wiki - Analytics')
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
    const { unmount: u1 } = renderAt('/catalogs')
    expect(document.title).toBe('Wod.Wiki - Notebooks')
    u1()

    const { unmount: u2 } = renderAt('/journal/2026-01-01')
    expect(document.title).toBe('Wod.Wiki - Journal')
    u2()

    const { unmount: u3 } = renderAt('/effort/push-up')
    expect(document.title).toBe('Wod.Wiki - Journal')
    u3()

    renderAt('/playground/abc')
    expect(document.title).toBe('Wod.Wiki - Journal')
  })
})
