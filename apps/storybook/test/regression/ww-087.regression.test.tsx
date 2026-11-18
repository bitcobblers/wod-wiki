/**
 * WW-087 — Runtime gate dialog renders at 0x0 on viewports <= 820px wide.
 *
 * Expected behavior: FocusedDialog hosting the Workout dialog paints full-viewport
 * (fixed inset-0) on <= 820px viewports and is never hidden or collapsed to 0x0.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FocusedDialog } from '@/components/molecules/FocusedDialog';

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
});

describe('WW-087 — mobile runtime gate dialog size', () => {
  it('renders the Workout FocusedDialog with full-viewport classes at 375x812', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });

    render(
      <FocusedDialog title="Workout" onClose={() => {}}>
        <div>Ready to Start</div>
      </FocusedDialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Workout' });
    expect(dialog).toBeVisible();
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(dialog.className).not.toMatch(/\bw-0\b|\bh-0\b|\bhidden\b/);
  });
});
