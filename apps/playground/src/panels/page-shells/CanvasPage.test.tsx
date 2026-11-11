import React from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { CanvasPage } from './CanvasPage';

afterEach(() => {
  cleanup();
});

describe('CanvasPage', () => {
  it('renders the title and children', () => {
    render(
      <NuqsTestingAdapter hasMemory>
        <CanvasPage title="Test Page" index={[{ id: 'intro', label: 'Intro', type: 'heading' }]} activeSectionId="intro">
          <div data-testid="content">Hello</div>
        </CanvasPage>
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText('Test Page')).toBeTruthy();
    expect(screen.getByTestId('content')).toBeTruthy();
  });
});
