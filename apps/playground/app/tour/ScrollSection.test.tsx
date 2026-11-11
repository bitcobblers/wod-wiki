/**
 * ScrollSection.test.tsx — unit tests for the ScrollSection primitive component.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ScrollSection } from './ScrollSection'

// Mock IntersectionObserver
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

let observerCallback: (entries: IntersectionObserverEntry[]) => void

describe('ScrollSection', () => {
  beforeEach(() => {
    mockObserve.mockReset()
    mockDisconnect.mockReset()

    const ioMock = class MockIntersectionObserver {
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        observerCallback = cb
      }
      observe = mockObserve
      unobserve = vi.fn()
      disconnect = mockDisconnect
    }

    window.IntersectionObserver = ioMock as unknown as typeof IntersectionObserver
    globalThis.IntersectionObserver = ioMock as unknown as typeof IntersectionObserver

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })
  it('renders stickyView, slides, and footer', () => {
    render(
      <ScrollSection
        id="test-section"
        title="Test Section"
        stickyView={<div data-testid="sticky-content">Sticky Content</div>}
        slides={<div data-testid="slides-content">Slides Content</div>}
        footer={<div data-testid="footer-content">Footer Content</div>}
      />,
    )

    expect(screen.getByText('Test Section')).toBeTruthy()
    expect(screen.getByTestId('sticky-content')).toBeTruthy()
    expect(screen.getByTestId('slides-content')).toBeTruthy()
    expect(screen.getByTestId('footer-content')).toBeTruthy()
  })

  it('notifies onVisibilityChange when IntersectionObserver triggers', () => {
    const onVisibilityChange = vi.fn()
    render(
      <ScrollSection
        id="test-section"
        stickyView={<div>Sticky</div>}
        slides={<div>Slides</div>}
        onVisibilityChange={onVisibilityChange}
      />,
    )

    expect(mockObserve).toHaveBeenCalled()

    // Trigger intersection
    observerCallback([{ isIntersecting: true } as IntersectionObserverEntry])
    expect(onVisibilityChange).toHaveBeenCalledWith(true)

    observerCallback([{ isIntersecting: false } as IntersectionObserverEntry])
    expect(onVisibilityChange).toHaveBeenCalledWith(false)
  })
})
