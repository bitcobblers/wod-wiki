import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { WodWikiMark, WodWikiWordmark } from './WodWikiBrand';

afterEach(() => {
  cleanup();
});

describe('WodWikiBrand', () => {
  it('renders WodWikiMark as decorative by default with Mineral Slate colors', () => {
    const { container } = render(<WodWikiMark />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(container.innerHTML).toContain('#49698d');
    expect(container.innerHTML).toContain('#fcfbf8');
    expect(container.innerHTML).toContain('#d6e4f0');
  });

  it('exposes role="img" when aria-label is supplied', () => {
    const { getByRole } = render(<WodWikiMark aria-label="WOD.wiki emblem" size={48} />);
    const img = getByRole('img', { name: 'WOD.wiki emblem' });

    expect(img.getAttribute('aria-hidden')).toBeNull();
    expect(img.getAttribute('width')).toBe('48');
    expect(img.getAttribute('height')).toBe('48');
  });

  it('renders WodWikiWordmark with WOD + monospace .wiki and optional mark', () => {
    const { container, getByText, rerender } = render(<WodWikiWordmark size="lg" />);

    expect(getByText('WOD')).toBeDefined();
    const suffix = getByText('.wiki');
    expect(suffix.className).toContain('font-mono');
    expect(container.querySelector('svg')).not.toBeNull();

    rerender(<WodWikiWordmark showMark={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
