import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host'
import { loadSampleData, setSampleDataService, hasSampleData } from '@/services/analytics/sample'
import { SampleDataPrompt } from './SampleDataPrompt'

const openHosts: PlaygroundHostHandle[] = []

afterEach(async () => {
  cleanup()
  for (const host of openHosts.splice(0)) {
    setSampleDataService(host.storageService)
    await host.cleanup()
  }
})

describe('SampleDataPrompt pending state & idempotency (WW-006)', () => {
  it('disables the button, sets aria-busy, and renders loading copy while loadSampleData is unresolved', async () => {
    let sampleLoaded = false
    let loadCalls = 0
    let resolveLoad!: (value: { facts: number }) => void
    let changedCalls = 0

    const deps = {
      hasSampleData: async () => sampleLoaded,
      loadSampleData: () => {
        loadCalls += 1
        return new Promise<{ facts: number }>((resolve) => {
          resolveLoad = (val) => {
            sampleLoaded = true
            resolve(val)
          }
        })
      },
      purgeSampleData: async () => {
        sampleLoaded = false
      },
    }

    render(
      <MemoryRouter>
        <SampleDataPrompt
          layout="card"
          deps={deps}
          onChanged={() => {
            changedCalls += 1
          }}
        />
      </MemoryRouter>,
    )

    const button = await screen.findByRole('button', { name: /Preview with sample data/i })
    expect(button.getAttribute('type')).toBe('button')
    expect((button as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(button)
    })

    const loadingButton = screen.getByRole('button', { name: /Loading sample data/i })
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true)
    expect(loadingButton.getAttribute('aria-busy')).toBe('true')
    expect(loadCalls).toBe(1)

    // Extra click while pending must be ignored
    await act(async () => {
      fireEvent.click(loadingButton)
    })
    expect(loadCalls).toBe(1)

    await act(async () => {
      resolveLoad({ facts: 42 })
    })

    await waitFor(() => {
      expect(screen.getByText('Sample data loaded')).toBeDefined()
    })
    expect(changedCalls).toBe(1)
  })

  it('deduplicates concurrent loadSampleData() calls with an in-flight promise guard', async () => {
    const host = await setupPlaygroundTestHost()
    openHosts.push(host)

    let txCount = 0
    const origWithTransaction = host.storageService.withTransaction.bind(host.storageService)
    const instrumentedService = Object.create(host.storageService) as typeof host.storageService
    instrumentedService.withTransaction = async (stores, fn) => {
      txCount += 1
      await new Promise((r) => setTimeout(r, 2))
      return origWithTransaction(stores, fn)
    }
    setSampleDataService(instrumentedService)

    const [first, second] = await Promise.all([loadSampleData(), loadSampleData()])
    expect(first.facts).toBeGreaterThan(0)
    expect(second).toEqual(first)

    // 16 weeks * 3 sessions/week = 48 sessions; without deduplication, concurrent
    // calls before the first finishes would run 96 transactions and double-import!
    expect(txCount).toBe(48)
    expect(await hasSampleData()).toBe(true)
  })
})
