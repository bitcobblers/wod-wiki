import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TEST_IDS } from '@/lib/testIds';
import { StickyPageHeader } from './StickyPageHeader';

describe('StickyPageHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders sticky boundary with title and primary accent indicator', () => {
    const { container } = render(
      <StickyPageHeader
        title="Canvas"
        titleTestId="canvas-title"
      />
    );

    const boundary = container.querySelector('[data-page-sticky-boundary="true"]');
    expect(boundary).not.toBeNull();
    expect(boundary?.className).toContain('sticky');
    expect(boundary?.className).toContain('top-0');
    expect(boundary?.className).toContain('z-30');

    const titleEl = screen.getByTestId('canvas-title');
    expect(titleEl.textContent).toBe('Canvas');

    // Accent bar indicator exists
    const accent = container.querySelector('.bg-primary');
    expect(accent).not.toBeNull();
  });

  it('renders titleAccessory, subtitle, and actions alongside the title', () => {
    render(
      <StickyPageHeader
        title="Dashboard"
        subtitle="Your analytics overview"
        titleAccessory={<span data-testid="test-badge">11/11</span>}
        actions={<button data-testid="test-action">Save</button>}
      />
    );

    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Your analytics overview')).toBeDefined();
    expect(screen.getByTestId('test-badge').textContent).toBe('11/11');
    expect(screen.getByTestId('test-action')).toBeDefined();
  });

  it('renders subheader below the title row when provided', () => {
    render(
      <StickyPageHeader
        title="Library"
        subheader={<div data-testid="test-subheader">Search bar</div>}
      />
    );

    expect(screen.getByText('Library')).toBeDefined();
    expect(screen.getByTestId('test-subheader').textContent).toBe('Search bar');
  });

  it('renders right-aligned actions in the header', () => {
    render(
      <StickyPageHeader
        title="README"
        actions={<button data-testid="edit-btn">Edit</button>}
      />
    );

    expect(screen.getByText('README')).toBeDefined();
    expect(screen.getByTestId('edit-btn')).toBeDefined();
  });

  it('renders parent breadcrumb pill top-left when parent is provided', () => {
    render(
      <MemoryRouter>
        <StickyPageHeader
          parent={{ label: 'Efforts', to: '/efforts' }}
          title="Air Squat"
        />
      </MemoryRouter>
    );

    const link = screen.getByTestId(TEST_IDS.PAGE_HEADER_PARENT_BREADCRUMB);
    expect(link.getAttribute('href')).toBe('/efforts');
    expect(link.textContent).toContain('Efforts');
    expect(screen.getByText('Air Squat')).toBeDefined();
  });
});
