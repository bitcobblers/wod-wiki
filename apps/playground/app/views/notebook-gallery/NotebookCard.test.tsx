import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotebookCard } from './NotebookCard'
import type { NotebookSummary } from './notebookGalleryModel'

afterEach(() => {
  cleanup()
})

const installedFeed: NotebookSummary = {
  packageId: 'community-crossfit-programming',
  slug: 'crossfit-programming',
  kind: 'feed',
  label: 'CrossFit Programming',
  description: 'Weekly CrossFit programming.',
  categories: ['crossfit'],
  sourceLabel: 'Common',
  href: '/feeds/crossfit-programming',
  itemCount: 42,
  latestDate: '2026-10-05',
  firstDate: '2026-08-01',
  installed: true,
}

const registryOnlyCollection: NotebookSummary = {
  packageId: 'community-crossfit-girls',
  slug: 'crossfit-girls',
  kind: 'collection',
  label: 'CrossFit Girls',
  description: 'Classic benchmark workouts.',
  categories: [],
  sourceLabel: 'Common',
  repositoryUrl: 'https://github.com/bitcobblers/wod-wiki-community',
  href: '/collections/crossfit-girls',
  itemCount: 0,
  installed: false,
}

describe('NotebookCard', () => {
  it('installed notebook links to its detail surface with stats', () => {
    render(
      <MemoryRouter>
        <NotebookCard notebook={installedFeed} />
      </MemoryRouter>,
    )
    const open = screen.getByTestId('notebook-card-open')
    expect(open.getAttribute('href')).toBe('/feeds/crossfit-programming')
    expect(screen.getByText('42 workouts')).toBeDefined()
    expect(screen.getByText('updated Oct 5, 2026')).toBeDefined()
    expect(screen.queryByTestId('notebook-card-import')).toBeNull()
    expect(screen.getByText('crossfit')).toBeDefined()
  })

  it('registry-only notebook renders an Import action wired to onImport', () => {
    let imported: string | null = null
    render(
      <MemoryRouter>
        <NotebookCard
          notebook={registryOnlyCollection}
          onImport={id => { imported = id }}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('notebook-card-import'))
    expect(imported).toBe('community-crossfit-girls')
    // No local stats for an uninstalled package.
    expect(screen.queryByText('0 workouts')).toBeNull()
    expect(screen.queryByText(/^updated /)).toBeNull()
  })

  it('monogram cover renders the label initial when no image is declared', () => {
    render(
      <MemoryRouter>
        <NotebookCard notebook={installedFeed} />
      </MemoryRouter>,
    )
    expect(screen.getByText('C')).toBeDefined()
  })

  it('importing state disables the button and shows progress text', () => {
    render(
      <MemoryRouter>
        <NotebookCard notebook={registryOnlyCollection} onImport={() => {}} importing />
      </MemoryRouter>,
    )
    const button = screen.getByTestId('notebook-card-import') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Importing')).toBeDefined()
  })

  it('renders the inline status line from the owning section', () => {
    render(
      <MemoryRouter>
        <NotebookCard
          notebook={registryOnlyCollection}
          onImport={() => {}}
          status={{ text: 'Sync failed. Check connection and try again.', tone: 'error' }}
        />
      </MemoryRouter>,
    )
    const status = screen.getByTestId('notebook-card-status')
    expect(status.getAttribute('role')).toBe('alert')
    expect(status.textContent).toContain('Sync failed')
  })
})
