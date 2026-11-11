import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WqlWindowPicker } from '../WqlWindowPicker'

afterEach(cleanup)

describe('WqlWindowPicker', () => {
  it('renders current window label and opens dropdown on click', () => {
    let currentQuery = ':note{tags:pr} last 4w'
    const { rerender } = render(
      <WqlWindowPicker
        query={currentQuery}
        onQueryChange={(w) => { currentQuery = w }}
      />
    )

    const trigger = screen.getByTestId('wql-window-picker-trigger')
    expect(trigger.textContent).toContain('last 4w')

    fireEvent.click(trigger)
    expect(screen.getByTestId('wql-window-preset-last 1w')).toBeDefined()
    expect(screen.getByTestId('wql-window-preset-all')).toBeDefined()
    expect(screen.getByTestId('wql-calendar-grid')).toBeDefined()
  })

  it('selects preset and updates WQL query', () => {
    let nextQuery = ''
    render(
      <WqlWindowPicker
        query=":journal{} last 4w"
        onQueryChange={(w) => { nextQuery = w }}
      />
    )

    fireEvent.click(screen.getByTestId('wql-window-picker-trigger'))
    fireEvent.click(screen.getByTestId('wql-window-preset-last 8w'))
    expect(nextQuery).toContain('last 8w')
  })

  it('selects dates to create a range in WQL', () => {
    let nextQuery = ''
    render(
      <WqlWindowPicker
        query=":note{tags:pr}"
        onQueryChange={(w) => { nextQuery = w }}
      />
    )

    fireEvent.click(screen.getByTestId('wql-window-picker-trigger'))

    // Click day 10
    const dayButtons = screen.getAllByRole('button').filter(b => b.dataset.testid?.startsWith('wql-calendar-day-'))
    expect(dayButtons.length).toBeGreaterThan(15)

    const day1 = dayButtons[5]!
    const day2 = dayButtons[10]!
    const key1 = day1.dataset.testid!.replace('wql-calendar-day-', '')
    const key2 = day2.dataset.testid!.replace('wql-calendar-day-', '')

    fireEvent.click(day1)
    expect(nextQuery).toContain(`from ${key1} to ${key1}`)

    fireEvent.click(day2)
    const [start, end] = key1 <= key2 ? [key1, key2] : [key2, key1]
    expect(nextQuery).toContain(`from ${start} to ${end}`)
  })

  it('navigates previous and next month and clears window', () => {
    let nextQuery = ''
    render(
      <WqlWindowPicker
        query=":journal{} last 4w"
        onQueryChange={(w) => { nextQuery = w }}
      />
    )

    fireEvent.click(screen.getByTestId('wql-window-picker-trigger'))
    const prevBtn = screen.getByTestId('wql-calendar-prev-month')
    const nextBtn = screen.getByTestId('wql-calendar-next-month')
    fireEvent.click(prevBtn)
    fireEvent.click(nextBtn)

    const clearBtn = screen.getByTestId('wql-window-picker-clear')
    fireEvent.click(clearBtn)
    expect(nextQuery).not.toContain('last 4w')
  })
})
