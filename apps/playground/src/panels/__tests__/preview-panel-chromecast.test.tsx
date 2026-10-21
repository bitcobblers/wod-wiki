import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReceiverPreviewPanel } from '../preview-panel-chromecast';

describe('ReceiverPreviewPanel', () => {
  afterEach(() => {
    cleanup();
  });

  const makePreviewData = (blocks: { id: string; title: string; statementCount?: number; timerHint?: string; dialect?: string; contentPreview?: string }[]) => ({
    title: 'Test Workout',
    blocks: blocks.map((b) => ({
      id: b.id,
      title: b.title,
      statementCount: b.statementCount ?? 0,
      timerHint: b.timerHint,
      dialect: b.dialect,
      contentPreview: b.contentPreview,
    })),
  });

  it('renders title and block list', () => {
    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([
          { id: 'block-1', title: 'Fran', statementCount: 3 },
          { id: 'block-2', title: 'Grace', statementCount: 2 },
        ])}
      />,
    );

    expect(screen.getByText('Test Workout')).toBeDefined();
    expect(screen.getByText('Fran')).toBeDefined();
    expect(screen.getByText('Grace')).toBeDefined();
    expect(screen.getByText('3 steps')).toBeDefined();
  });

  it('applies getFocusProps to each block', () => {
    const getFocusProps = mock((id: string) => ({
      'data-nav-id': id,
      'data-nav-focused': false,
      tabIndex: 0,
      ref: () => {},
      onFocus: () => {},
    }));

    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([
          { id: 'block-1', title: 'Fran' },
          { id: 'block-2', title: 'Grace' },
        ])}
        getFocusProps={getFocusProps}
      />,
    );

    const blocks = screen.getAllByText(/Fran|Grace/);
    expect(blocks.length).toBe(2);
    expect(getFocusProps.mock.calls.length).toBe(2);
    expect(getFocusProps.mock.calls[0][0]).toBe('preview-block-0');
    expect(getFocusProps.mock.calls[1][0]).toBe('preview-block-1');
  });

  it('calls onBlockSelect when a block is clicked', () => {
    const onBlockSelect = mock((_blockId: string, _index: number) => {});

    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([
          { id: 'block-1', title: 'Fran' },
          { id: 'block-2', title: 'Grace' },
        ])}
        onBlockSelect={onBlockSelect}
      />,
    );

    const graceBlock = screen.getByText('Grace').closest('[data-nav-id]') ?? screen.getByText('Grace').closest('div');
    if (graceBlock) {
      fireEvent.click(graceBlock);
    }

    expect(onBlockSelect.mock.calls.length).toBe(1);
    expect(onBlockSelect.mock.calls[0]).toEqual(['block-2', 1]);
  });

  it('renders empty state when no blocks are present', () => {
    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([])}
      />,
    );

    expect(screen.getByText('Test Workout')).toBeDefined();
    expect(screen.queryByText('Fran')).toBeNull();
  });

  it('renders timer hint and dialect badges', () => {
    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([
          { id: 'block-1', title: 'EMOM', timerHint: '10:00', dialect: 'log' },
        ])}
      />,
    );

    expect(screen.getByText('10:00')).toBeDefined();
    expect(screen.getByText('log')).toBeDefined();
  });

  it('renders content preview when provided', () => {
    render(
      <ReceiverPreviewPanel
        previewData={makePreviewData([
          { id: 'block-1', title: 'Fran', contentPreview: '21-15-9\nThrusters 95/65' },
        ])}
      />,
    );

    expect(screen.getByText(/21-15-9/)).toBeDefined();
    expect(screen.getByText(/Thrusters 95\/65/)).toBeDefined();
  });
});
