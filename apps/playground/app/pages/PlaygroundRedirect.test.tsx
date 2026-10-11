import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const navigateCalls: Array<{ to: string; options?: { replace?: boolean } }> = []
const createPlaygroundPageCalls: string[] = []
let shouldFailCreatePlaygroundPage = false
let existingPages: Array<{ id: string; updatedAt: number }> = []

const mockNavigate = (to: string, options?: { replace?: boolean }) => {
  navigateCalls.push({ to, options })
}

mock.module('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
  Navigate: ({ to }: { to: string }) => null,
}))

const createPlaygroundPageMock = mock(async (content: string) => {
  createPlaygroundPageCalls.push(content)
  if (shouldFailCreatePlaygroundPage) {
    throw new DOMException('Blocked by browser', 'SecurityError')
  }
  return '2026-05-19 15.30'
})

mock.module('../services/createPlaygroundPage', () => ({
  createPlaygroundPage: createPlaygroundPageMock,
}))

mock.module('../services/playgroundContent', () => ({
  playgroundContent: {
    getPagesByCategory: mock(async () => existingPages),
  },
}))

mock.module('../templates/defaultPlaygroundContent', () => ({
  DEFAULT_PLAYGROUND_CONTENT: {
    content: '# New playground\n',
  },
}))

const componentModule = import('./PlaygroundRedirect')

beforeEach(() => {
  navigateCalls.length = 0
  createPlaygroundPageCalls.length = 0
  shouldFailCreatePlaygroundPage = false
  existingPages = []
  createPlaygroundPageMock.mockClear()
})

describe('PlaygroundRedirect', () => {
  it('mints a fresh empty playground note', async () => {
    const { PlaygroundRedirect } = await componentModule

    render(<PlaygroundRedirect />)

    await waitFor(() => {
      expect(createPlaygroundPageCalls).toEqual(['# New playground\n'])
      expect(navigateCalls).toEqual([
        {
          to: '/playground/2026-05-19%2015.30',
          options: { replace: true },
        },
      ])
    })
  })

  it('still mints a fresh empty note when pages exist — /playgrounds is the resume surface', async () => {
    const { PlaygroundRedirect } = await componentModule
    existingPages = [
      { id: 'playground/older', updatedAt: 1000 },
      { id: 'playground/newer', updatedAt: 2000 },
    ]

    render(<PlaygroundRedirect />)

    await waitFor(() => {
      expect(createPlaygroundPageCalls).toEqual(['# New playground\n'])
      expect(navigateCalls).toEqual([
        {
          to: '/playground/2026-05-19%2015.30',
          options: { replace: true },
        },
      ])
    })
  })

  it('creates exactly one page under StrictMode when none exists', async () => {
    const { PlaygroundRedirect } = await componentModule

    render(
      <StrictMode>
        <PlaygroundRedirect />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(createPlaygroundPageCalls).toEqual(['# New playground\n'])
      expect(navigateCalls.length).toBeGreaterThanOrEqual(1)
      expect(navigateCalls).toContainEqual({
        to: '/playground/2026-05-19%2015.30',
        options: { replace: true },
      })
    })
  })

  it('mints exactly one note even when the first-note wizard would still open', async () => {
    // The wizard gates on profile state and opens on the note page itself —
    // it must not interact with fresh-page creation here (N8 multiply bug).
    const { PlaygroundRedirect } = await componentModule
    existingPages = [{ id: 'playground/existing', updatedAt: 2000 }]

    render(<PlaygroundRedirect />)

    await waitFor(() => {
      expect(createPlaygroundPageCalls).toEqual(['# New playground\n'])
      expect(navigateCalls).toEqual([
        {
          to: '/playground/2026-05-19%2015.30',
          options: { replace: true },
        },
      ])
    })
  })

  it('renders a retry state when note creation fails, then redirects after retry', async () => {
    const { PlaygroundRedirect } = await componentModule
    shouldFailCreatePlaygroundPage = true

    render(<PlaygroundRedirect />)

    await screen.findByText('Unable to create a new playground note.')
    expect(navigateCalls).toEqual([])

    shouldFailCreatePlaygroundPage = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(createPlaygroundPageCalls.length).toBe(2)
      expect(createPlaygroundPageCalls.every(content => content === '# New playground\n')).toBe(true)
      expect(navigateCalls).toContainEqual({
        to: '/playground/2026-05-19%2015.30',
        options: { replace: true },
      })
    })
  })
})
