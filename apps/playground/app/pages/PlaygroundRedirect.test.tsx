import { afterEach, describe, expect, it } from 'bun:test'
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Location } from 'react-router-dom'
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host'
import { createPlaygroundPage } from '../services/createPlaygroundPage'
import { PlaygroundRedirect } from './PlaygroundRedirect'

// Optional deps with production defaults: the real mint over the host's
// InMemoryStorage, wrapped to count how often the redirect mints a note.
const openHosts: PlaygroundHostHandle[] = []
let mints: number

function countingCreatePage(): (content: string) => Promise<string> {
  mints = 0
  return async (content) => {
    mints += 1
    return createPlaygroundPage(content)
  }
}

// Rendered synchronously (RTL auto-act) on purpose: an `act(async)` here
// would block on the host's whole-corpus seed (~1020 pages) before returning.
async function renderRedirect(
  ui: React.ReactElement = <PlaygroundRedirect createPage={countingCreatePage()} />,
  seed?: (host: PlaygroundHostHandle) => Promise<void>,
) {
  const host = await setupPlaygroundTestHost()
  openHosts.push(host)
  await seed?.(host)
  let location: Location | null = null
  render(
    <PlaygroundProviderTree route="/" onLocationChange={(loc) => { location = loc }}>
      {ui}
    </PlaygroundProviderTree>,
  )
  const getLocation = () => location
  return { host, getLocation }
}

// The first mounted host seeds the bundled corpus; give the mint + seed room.
const NAVIGATE = { timeout: 30000 }

afterEach(async () => {
  cleanup()
  for (const host of openHosts.splice(0)) await host.cleanup()
})

describe('PlaygroundRedirect', () => {
  it('mints a fresh empty playground note', async () => {
    const { getLocation } = await renderRedirect()

    await waitFor(() => {
      expect(getLocation()?.pathname).toMatch(/^\/playground\/\S/)
    }, NAVIGATE)
    expect(mints).toBe(1)
  }, 60000)

  it('still mints a fresh empty note when pages exist — /playgrounds is the resume surface', async () => {
    const { getLocation } = await renderRedirect(<PlaygroundRedirect createPage={countingCreatePage()} />, async () => {
      await createPlaygroundPage('# an older playground\n')
    })

    await waitFor(() => {
      expect(getLocation()?.pathname).toMatch(/^\/playground\/\S/)
    }, NAVIGATE)
    // The seeded page is resumed from /playgrounds, not reloaded here: this
    // visit still mints exactly one fresh note.
    expect(mints).toBe(1)
    expect(getLocation()?.pathname).not.toBe('/playground/2026-05-19%2015.30')
  }, 60000)

  it('creates exactly one page under StrictMode when none exists', async () => {
    const { getLocation } = await renderRedirect(
      <StrictMode>
        <PlaygroundRedirect createPage={countingCreatePage()} />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(getLocation()?.pathname).toMatch(/^\/playground\/\S/)
    }, NAVIGATE)
    // The dedup promise collapses the double mount into one mint.
    expect(mints).toBe(1)
  }, 60000)

  it('mints exactly one note even when the first-note wizard would still open', async () => {
    // The wizard gates on profile state and opens on the note page itself —
    // it must not interact with fresh-page creation here (N8 multiply bug).
    const { getLocation } = await renderRedirect(<PlaygroundRedirect createPage={countingCreatePage()} />, async () => {
      await createPlaygroundPage('# an existing playground\n')
    })

    await waitFor(() => {
      expect(getLocation()?.pathname).toMatch(/^\/playground\/\S/)
    }, NAVIGATE)
    expect(mints).toBe(1)
  }, 60000)

  it('renders a retry state when note creation fails, then redirects after retry', async () => {
    let fail = true
    const { getLocation } = await renderRedirect(
      <PlaygroundRedirect
        createPage={async (content) => {
          if (fail) throw new DOMException('Blocked by browser', 'SecurityError')
          return createPlaygroundPage(content)
        }}
      />,
    )

    await screen.findByText('Unable to create a new playground note.')
    expect(getLocation()?.pathname).toBe('/')

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(getLocation()?.pathname).toMatch(/^\/playground\/\S/)
    }, NAVIGATE)
    expect(getLocation()?.pathname).not.toBe('/')
  }, 60000)
})
