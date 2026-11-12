import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { FullscreenTimer } from '@/components/organisms/review/FullscreenTimer';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost } from '@/testing/host';
import type { ScriptBlock } from '@/components/Editor/types';
import { resolveWorkoutRunIdentity } from '../SessionRunHost';

const NOTE_WITH_HEADINGS = `---
title: Tuesday Class Note
---

# Warmup

\`\`\`time
5:00 Row
\`\`\`

## Fran

\`\`\`time
(21-15-9)
  Thruster 43kg
  Pullups
\`\`\`
`;

function makeBlock(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return {
    id: 'block-fran',
    dialect: 'time',
    startLine: 12,
    endLine: 17,
    content: '(21-15-9)\n  Thruster 43kg\n  Pullups',
    state: 'idle',
    widgetIds: {},
    version: 1,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SessionRunHost workout identity and unified Stop lifecycle (Seam 4a)', () => {
  afterEach(() => {
    cleanup();
  });

  it('resolves nearest preceding Markdown heading and protocol format for a block in a multi-block Note', () => {
    const identity = resolveWorkoutRunIdentity(makeBlock(), NOTE_WITH_HEADINGS);
    expect(identity.workoutTitle).toBe('Fran');
    expect(identity.workoutFormat).toContain('21');
  });

  it('falls back to Note frontmatter title when no Markdown heading precedes the block', () => {
    const frontmatterOnly = `---
title: Helen Benchmark
---

\`\`\`time
(3 Rounds)
  Run 400m
  21 Kettlebell Swings 24kg
\`\`\`
`;
    const identity = resolveWorkoutRunIdentity(
      makeBlock({
        startLine: 4,
        endLine: 8,
        content: '(3 Rounds)\n  Run 400m\n  21 Kettlebell Swings 24kg',
      }),
      frontmatterOnly,
    );
    expect(identity.workoutTitle).toBe('Helen Benchmark');
    expect(identity.workoutFormat).toBe('3 Rounds');
  });

  it('renders resolved Note heading in FullscreenTimer and routes Exit on a Next-driven run through the single ClockCommandBoard Stop dialog', async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();

    const host = await renderWithPlaygroundHost(
      <FullscreenTimer
        block={makeBlock()}
        noteContent={NOTE_WITH_HEADINGS}
        onClose={onClose}
        onCompleteWorkout={onComplete}
      />,
    );

    // Header uses resolved workout heading ('Fran') rather than hardcoded 'Workout'
    expect(await screen.findByRole('dialog', { name: 'Fran' })).toBeDefined();

    // Advance twice via Next (Next-driven run: status stays 'idle' while outputs are captured)
    const nextBtn = await screen.findByTestId(TEST_IDS.TIMER_NEXT_BLOCK);
    fireEvent.click(nextBtn); // Pop WaitingToStart -> R1 Thruster
    fireEvent.click(nextBtn); // Complete R1 Thruster -> captures 1 segment output

    await waitFor(() => {
      expect(screen.getByText(/results? captured/)).toBeDefined();
    });

    // Clicking header Exit routes through ClockCommandBoard's single CLOCK_STOP_CONFIRM dialog
    fireEvent.click(screen.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE));
    expect(await screen.findByTestId(TEST_IDS.CLOCK_STOP_CONFIRM)).toBeDefined();
    expect(screen.queryByTestId('stop-confirm')).toBeNull();
    host.cleanup();
  });
});
