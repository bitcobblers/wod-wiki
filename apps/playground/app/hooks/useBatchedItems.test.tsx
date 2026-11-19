/**
 * useBatchedItems (#861) — progressive rendering: first batch up front,
 * another batch whenever the sentinel nears the viewport, reset on a new
 * result set. IntersectionObserver is mocked (absent in the test env) with
 * a manual trigger; the harness attaches the sentinel ref so the effect
 * actually observes.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useBatchedItems } from './useBatchedItems'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(isIntersecting = true) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

const realIO = globalThis.IntersectionObserver

function setupIO() {
  MockIntersectionObserver.instances = []
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
}

afterEach(() => {
  cleanup()
  globalThis.IntersectionObserver = realIO
})

function Harness({ xs, batch, expose }: { xs: number[]; batch: number; expose?: (hooks: { growTo: (n: number) => void }) => void }) {
  const { visible, hasMore, sentinelRef, total, growTo } = useBatchedItems(xs, batch)
  expose?.({ growTo })
  return (
    <div>
      <output data-testid="visible">{visible.join(',')}</output>
      <output data-testid="hasMore">{String(hasMore)}</output>
      <output data-testid="total">{total}</output>
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  )
}

const items = (n: number) => Array.from({ length: n }, (_, i) => i)
const visible = () => screen.getByTestId('visible').textContent
const hasMore = () => screen.getByTestId('hasMore').textContent === 'true'

describe('useBatchedItems', () => {
  it('renders the first batch and reports the remainder', () => {
    setupIO()
    render(<Harness xs={items(10)} batch={3} />)
    expect(visible()).toBe('0,1,2')
    expect(hasMore()).toBe(true)
    expect(screen.getByTestId('total').textContent).toBe('10')
  })

  it('grows a batch per sentinel approach until the set is exhausted', () => {
    setupIO()
    render(<Harness xs={items(10)} batch={3} />)

    act(() => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!.trigger())
    expect(visible()).toBe('0,1,2,3,4,5')

    act(() => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!.trigger())
    act(() => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!.trigger())
    expect(visible()).toBe('0,1,2,3,4,5,6,7,8,9')
    expect(hasMore()).toBe(false)
  })

  it('does not grow when the sentinel is not intersecting', () => {
    setupIO()
    render(<Harness xs={items(10)} batch={3} />)
    act(() => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!.trigger(false))
    expect(visible()).toBe('0,1,2')
  })

  it('resets to the first batch when the result set changes', () => {
    setupIO()
    const { rerender } = render(<Harness xs={items(10)} batch={3} />)
    act(() => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]!.trigger())
    expect(visible()).toBe('0,1,2,3,4,5')

    rerender(<Harness xs={items(4)} batch={3} />)
    expect(visible()).toBe('0,1,2')
  })

  it('observes nothing when the set fits in one batch', () => {
    setupIO()
    render(<Harness xs={items(2)} batch={3} />)
    expect(hasMore()).toBe(false)
    expect(MockIntersectionObserver.instances).toHaveLength(0)
  })

  it('growTo materializes through a target index without waiting for the sentinel', () => {
    setupIO()
    let hooks: { growTo: (n: number) => void } | undefined
    render(<Harness xs={items(10)} batch={3} expose={h => { hooks = h }} />)
    expect(visible()).toBe('0,1,2')

    // Jump-to-group: materialize items 0..6 in one step; shrinking is ignored.
    act(() => hooks!.growTo(7))
    expect(visible()).toBe('0,1,2,3,4,5,6')
    act(() => hooks!.growTo(2))
    expect(visible()).toBe('0,1,2,3,4,5,6')
    // Beyond the set clamps.
    act(() => hooks!.growTo(99))
    expect(visible()).toBe('0,1,2,3,4,5,6,7,8,9')
    expect(hasMore()).toBe(false)
  })

  it('does not reset growth when clicked immediately upon DOM commit before passive effects flush', async () => {
    setupIO()
    function AsyncHarness() {
      const [xs, setXs] = useState<number[]>([])
      const { visible: batchVisible, hasMore: more, sentinelRef, growTo } = useBatchedItems(xs, 3)
      useEffect(() => {
        const timer = setTimeout(() => {
          void Promise.resolve().then(() => setXs(items(10)))
        }, 0)
        return () => clearTimeout(timer)
      }, [])
      return (
        <div>
          <output data-testid="visible">{batchVisible.join(',')}</output>
          {more && (
            <div ref={sentinelRef}>
              <button type="button" data-testid="more" onClick={() => growTo(batchVisible.length + 3)}>
                Show more
              </button>
            </div>
          )}
        </div>
      )
    }

    let resolveClick!: () => void
    const clicked = new Promise<void>(resolve => {
      resolveClick = resolve
    })
    const observer = new MutationObserver(() => {
      const btn = screen.queryByTestId('more')
      if (!btn) return
      observer.disconnect()
      act(() => {
        fireEvent.click(btn)
      })
      resolveClick()
    })

    try {
      render(<AsyncHarness />)
      observer.observe(document.body, { childList: true, subtree: true })
      await clicked
      await act(async () => {})
      expect(visible()).toBe('0,1,2,3,4,5')
    } finally {
      observer.disconnect()
    }
  })
})
