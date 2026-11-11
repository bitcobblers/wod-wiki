import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Note } from '@bitcobblers/wod-wiki-core';
import { listScopedPropertyOverrides } from '@bitcobblers/wod-wiki-engine';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';
import { PropertyOverrideSheet } from './PropertyOverrideSheet';

describe('PropertyOverrideSheet', () => {
  afterEach(() => {
    cleanup();
  });

  it('scopes an Effort override to either personal notebook/custom runtime or a shared user Notebook on the canonical slug', async () => {
    const storage = new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
    const sampleDoc = [
      '---',
      'slug: snatch',
      'label: Power Snatch Override',
      'aliases:',
      '  - snatches',
      'baseAttributes:',
      '  met: 8.8',
      '---',
      '# Power Snatch Override',
      '',
    ].join('\n');

    await storage.readwrite('notes').put({
      id: 'notebook/barbell-club',
      notebookId: 'notebook/barbell-club',
      title: 'Barbell Club',
      rawContent: '# Barbell Club\n',
      sourceRevision: 1,
      blocks: {},
      createdAt: 1000,
      seedOrigin: 'user',
    } satisfies Note);

    let chosenTarget: string | null = null;
    render(
      <PropertyOverrideSheet
        open={true}
        onOpenChange={() => {}}
        kind="effort"
        slug="snatch"
        label="Snatch"
        rawContent={sampleDoc}
        storageOverride={storage}
        onSaved={(target) => {
          chosenTarget = target;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('override-target-notebook/barbell-club')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('override-target-notebook/barbell-club'));

    await waitFor(() => {
      expect(chosenTarget).toBe('notebook/barbell-club');
    });

    const overrides = await listScopedPropertyOverrides(storage, {
      notebookId: 'notebook/barbell-club',
      kind: 'effort',
      slug: 'snatch',
    });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.slug).toBe('snatch');

    await storage.close();
  });
});
