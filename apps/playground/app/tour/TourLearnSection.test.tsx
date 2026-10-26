/**
 * TourLearnSection.test.tsx — Learn the Language section CTAs.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TourLearnSection } from './TourLearnSection';
import type { Chapter, Quest } from '../canvas/parseCanvasMarkdown';

const chapters: Chapter[] = [];
const quests: Quest[] = [];

function renderSection() {
  return render(
    <MemoryRouter>
      <TourLearnSection quests={quests} chapters={chapters} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TourLearnSection', () => {
  it('links Lesson 1 to /page/guide-start', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /Start Lesson 1/ });
    expect(link.getAttribute('href')).toBe('/page/guide-start');
  });

  it('links Cheat sheet to the start reference anchor', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /Cheat sheet/ });
    expect(link.getAttribute('href')).toBe('/page/guide-start?h=reference');
  });
});
