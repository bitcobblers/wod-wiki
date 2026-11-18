import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';

import { PageNavDropdown } from './PageNavDropdown';

describe('PageNavDropdown', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the controlled active section label', () => {
    render(
      <PageNavDropdown
        links={[
          { id: 'overview', label: 'Overview' },
          { id: 'details', label: 'Details' },
        ]}
        activeSectionId="details"
        scrollToSection={mock()}
      />,
    );

    expect(screen.getByLabelText('Page sections').textContent).toContain('Details');
  });

  it('scrolls to the section on primary click for plain links', () => {
    const scrollToSection = mock(() => {})
    render(
      <PageNavDropdown
        links={[{ id: 'overview', label: 'Overview', type: 'heading' }]}
        scrollToSection={scrollToSection}
      />,
    )

    act(() => {
      screen.getByLabelText('Page sections').click()
    })
    act(() => {
      screen.getByRole('button', { name: 'Overview' }).click()
    })
    expect(scrollToSection).toHaveBeenCalledWith('overview')
  })

  it('navigates on primary click for collection workout links with the link icon', () => {
    const onRun = mock(() => {})
    const scrollToSection = mock(() => {})
    render(
      <PageNavDropdown
        links={[
          {
            id: 'workout-../../markdown/collections/girls/Fran.md',
            label: 'Fran',
            type: 'time',
            onRun,
            runIcon: 'link',
          },
        ]}
        scrollToSection={scrollToSection}
      />,
    )

    act(() => {
      screen.getByLabelText('Page sections').click()
    })
    act(() => {
      screen.getByRole('button', { name: 'Fran' }).click()
    })
    expect(onRun).toHaveBeenCalled()
    expect(scrollToSection).not.toHaveBeenCalled()
  })
});
