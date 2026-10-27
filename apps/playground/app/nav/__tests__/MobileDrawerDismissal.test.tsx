import { describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NavigationDrawerProvider } from '../NavigationDrawerContext'
import { NavProvider } from '../NavContext'
import { AppRail } from '../AppRail'
import { NavSidebar } from '../NavSidebar'
import { MenuList } from '../MenuList'
import { buildAppNavTree } from '../appNavTree'
import type { CanvasRoute } from '../../canvas/canvasRoutes'

describe('Mobile drawer dismissal contract', () => {
  it('calls closeDrawer when tapping an L1 rail item or avatar in AppRail', () => {
    const closeMock = mock(() => {})
    const tree = buildAppNavTree(() => {})

    render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={tree}>
          <NavigationDrawerProvider close={closeMock}>
            <AppRail onSearch={() => {}} />
          </NavigationDrawerProvider>
        </NavProvider>
      </MemoryRouter>,
    )

    // Clicking avatar (Home) closes the drawer
    const avatar = screen.getByLabelText('Wod Wiki home')
    fireEvent.click(avatar)
    expect(closeMock).toHaveBeenCalledTimes(1)

    // Clicking an L1 item (Notebooks) closes the drawer
    const notebooks = screen.getByLabelText('Notebooks')
    fireEvent.click(notebooks)
    expect(closeMock).toHaveBeenCalledTimes(2)

    cleanup()
  })

  it('calls closeDrawer when tapping an L2 guide item in NavSidebar', () => {
    const closeMock = mock(() => {})
    const dummyRoutes = [
      {
        route: '/page/guide-start',
        page: { frontmatter: { type: 'guide' }, sections: [{ heading: 'Getting Started' }] } as unknown as CanvasRoute['page'],
      },
    ]
    const tree = buildAppNavTree(() => {}, dummyRoutes)

    render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={tree}>
          <NavigationDrawerProvider close={closeMock}>
            <NavSidebar />
          </NavigationDrawerProvider>
        </NavProvider>
      </MemoryRouter>,
    )

    const guideLink = screen.getByText('Getting Started')
    fireEvent.click(guideLink)
    expect(closeMock).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('calls closeDrawer when activating a link in MenuList', () => {
    const closeMock = mock(() => {})
    const entries = [
      { kind: 'link' as const, id: 'test-1', label: 'Section One', sectionId: 'sec-1' },
      { kind: 'link' as const, id: 'test-2', label: 'Route Link', to: '/notebooks' },
    ]

    render(
      <MemoryRouter initialEntries={['/']}>
        <NavProvider tree={[]}>
          <NavigationDrawerProvider close={closeMock}>
            <MenuList entries={entries} />
          </NavigationDrawerProvider>
        </NavProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Section One'))
    expect(closeMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Route Link'))
    expect(closeMock).toHaveBeenCalledTimes(2)

    cleanup()
  })
})
