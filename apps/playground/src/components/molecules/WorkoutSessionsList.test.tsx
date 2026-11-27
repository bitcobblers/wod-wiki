import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@/types/storage';
import { WorkoutSessionsList } from './PublicationPill';

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 'sess-1',
    noteId: 'note-1',
    blockId: 'block-1',
    blockVersion: 1,
    status: 'completed',
    startTime: 1_735_689_600_000,
    endTime: 1_735_689_658_000,
    duration: 58_000,
    completed: true,
    createdAt: 1_735_689_658_000,
    ...overrides,
  };
}

describe('WorkoutSessionsList', () => {
  it('labels stopped-early sessions with completed: false as Partial even when status is completed', () => {
    const partial = makeSession({
      id: 'sess-partial',
      status: 'completed',
      completed: false,
      roundsCompleted: 1,
    });
    const full = makeSession({
      id: 'sess-full',
      status: 'completed',
      completed: true,
      roundsCompleted: 1,
      startTime: 1_735_689_700_000,
    });
    const active = makeSession({
      id: 'sess-active',
      status: 'in-progress',
      completed: false,
      startTime: 1_735_689_800_000,
    });

    render(
      <MemoryRouter>
        <WorkoutSessionsList sessions={[partial, full, active]} />
      </MemoryRouter>,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('In progress');
    expect(items[1]!.textContent).toContain('Completed');
    expect(items[1]!.textContent).toContain('1 round');
    expect(items[1]!.textContent).not.toContain('1 rounds');
    expect(items[2]!.textContent).toContain('Partial');
    expect(items[2]!.textContent).not.toContain('Completed');
    expect(items[2]!.textContent).not.toContain('1 round');
  });
});
