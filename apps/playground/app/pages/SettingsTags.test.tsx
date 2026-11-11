import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';

describe('SettingsPage Tag Types', () => {
  let host: PlaygroundHostHandle;

  beforeEach(async () => {
    // Real providers + InMemoryStorage from the test host; seed the taxonomy
    // the tags section reads before mounting the page.
    host = await setupPlaygroundTestHost();

    await host.storageService.putTagType({
      id: 'type-equipment',
      name: 'equipment',
      label: 'Equipment',
      color: '#3b82f6',
      createdAt: 1000,
    });

    await host.storageService.putTag({
      id: 'tag-1',
      label: 'barbell',
      type: 'equipment',
      createdAt: 1000,
    });

    await host.storageService.putTag({
      id: 'tag-2',
      label: 'benchmark',
      createdAt: 1001,
    });
  });

  afterEach(async () => {
    cleanup();
    await host.cleanup();
  });

  async function renderTags() {
    await act(async () => {
      render(
        <PlaygroundProviderTree route="/settings/tags" routePath="/settings/:tab">
          <SettingsPage />
        </PlaygroundProviderTree>,
      );
    });
  }

  it('shows the taxonomy, with the tags themselves left to the Tags page', async () => {
    await renderTags();

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });
    // The tags live on /tags now — the settings section points there rather
    // than editing them a second time.
    expect(screen.getByText('/tags')).toBeTruthy();
    expect(screen.queryByText('barbell')).toBeNull();
  });

  it('counts the tags that use a type', async () => {
    await renderTags();

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });
    // One tag uses the equipment type; the count sits beside its name.
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('can create a new tag type from the UI', async () => {
    await renderTags();

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });
    const nameInput = screen.getByPlaceholderText('Type name (e.g. discipline)');
    const labelInput = screen.getByPlaceholderText('Display label (e.g. Discipline)');
    const addTypeBtn = screen.getByRole('button', { name: /Add Type/i });

    fireEvent.change(nameInput, { target: { value: 'movement' } });
    fireEvent.change(labelInput, { target: { value: 'Movement' } });
    fireEvent.click(addTypeBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Movement').length).toBeGreaterThan(0);
    });

    const types = await host.storageService.getAllTagTypes();
    expect(types.map((t) => t.name)).toContain('movement');
  });

  it('refuses to delete a type that tags still use', async () => {
    await renderTags();

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });

    const deleteButton = screen.getByLabelText('Delete tag type Equipment');
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
  });
});
