import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';

// Mock contexts
mock.module('@/contexts/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'system', setTheme: () => {} }),
}));
mock.module('@/contexts/AudioContext', () => ({
  useAudio: () => ({ isEnabled: true, toggleAudio: () => {}, playTestSound: () => {} }),
}));
mock.module('@/contexts/DebugModeContext', () => ({
  useDebugMode: () => ({ isDebugMode: false, toggleDebugMode: () => {} }),
}));

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

function renderSettings(initialPath = '/settings/tags') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SettingsPage Tag Types', () => {
  let memoryStorage: InMemoryStorage;

  beforeEach(async () => {
    memoryStorage = new InMemoryStorage();
    setStorageForTesting(memoryStorage);

    await storageService.putTagType({
      id: 'type-equipment',
      name: 'equipment',
      label: 'Equipment',
      color: '#3b82f6',
      createdAt: 1000,
    });

    await storageService.putTag({
      id: 'tag-1',
      label: 'barbell',
      type: 'equipment',
      createdAt: 1000,
    });

    await storageService.putTag({
      id: 'tag-2',
      label: 'benchmark',
      createdAt: 1001,
    });
  });

  it('shows the taxonomy, with the tags themselves left to the Tags page', async () => {
    renderSettings('/settings/tags');

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });
    // The tags live on /tags now — the settings section points there rather
    // than editing them a second time.
    expect(screen.getByText('/tags')).toBeTruthy();
    expect(screen.queryByText('barbell')).toBeNull();
  });

  it('counts the tags that use a type', async () => {
    renderSettings('/settings/tags');

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });
    // One tag uses the equipment type; the count sits beside its name.
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('can create a new tag type from the UI', async () => {
    renderSettings('/settings/tags');

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

    const types = await storageService.getAllTagTypes();
    expect(types.map((t) => t.name)).toContain('movement');
  });

  it('refuses to delete a type that tags still use', async () => {
    renderSettings('/settings/tags');

    await waitFor(() => {
      expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    });

    const deleteButton = screen.getByLabelText('Delete tag type Equipment');
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
  });
});
