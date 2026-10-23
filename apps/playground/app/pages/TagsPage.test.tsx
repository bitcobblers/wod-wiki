import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TagsPage } from './TagsPage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';

afterEach(() => {
    cleanup();
    resetStorageForTesting();
});

function renderTags() {
    return render(
        <MemoryRouter>
            <TagsPage />
        </MemoryRouter>
    );
}

describe('TagsPage', () => {
    beforeEach(async () => {
        setStorageForTesting(new InMemoryStorage());
    });

    it('lists the tags in the catalogue', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags();

        await waitFor(() => expect(screen.getByText('heavy')).toBeTruthy());
    });

    it('creates a tag and selects it', async () => {
        renderTags();

        const input = await screen.findByPlaceholderText('heavy');
        fireEvent.change(input, { target: { value: 'sprint' } });
        fireEvent.click(screen.getByText('Add Tag'));

        await waitFor(async () => {
            const tags = await storageService.getAllTags();
            expect(tags.map(tag => tag.label)).toEqual(['sprint']);
        });
    });

    it('saves the contributions a tag carries', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags();

        fireEvent.click(await screen.findByText('heavy'));
        fireEvent.click(await screen.findByText('Metric'));

        const typeInput = await screen.findByLabelText('Metric type');
        fireEvent.change(typeInput, { target: { value: 'intensity' } });
        const valueInput = screen.getByLabelText('Metric value');
        fireEvent.change(valueInput, { target: { value: 'heavy' } });

        fireEvent.click(screen.getByText('Save'));

        await waitFor(async () => {
            const tags = await storageService.getAllTags();
            expect(tags[0].contributions).toEqual([
                { kind: 'metric', type: 'intensity', value: 'heavy' },
            ]);
        });
    });

    it('filters the tag list by name and by kind', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', type: 'equipment', createdAt: 1000 });
        await storageService.putTag({ id: 'tag-2', label: 'benchmark', createdAt: 1001 });

        renderTags();

        await waitFor(() => expect(screen.getByText('heavy')).toBeTruthy());

        const search = screen.getByLabelText('Filter tags');
        fireEvent.change(search, { target: { value: 'bench' } });
        await waitFor(() => expect(screen.queryByText('heavy')).toBeNull());
        expect(screen.getByText('benchmark')).toBeTruthy();

        fireEvent.change(search, { target: { value: '' } });
        const kind = screen.getByLabelText('Filter by kind');
        fireEvent.change(kind, { target: { value: 'equipment' } });
        await waitFor(() => expect(screen.queryByText('benchmark')).toBeNull());
        expect(screen.getByText('heavy')).toBeTruthy();
    });

    it('refuses a second tag with the same name', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags();

        const input = await screen.findByPlaceholderText('heavy');
        fireEvent.change(input, { target: { value: 'heavy' } });
        fireEvent.click(screen.getByText('Add Tag'));

        await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    });
});
