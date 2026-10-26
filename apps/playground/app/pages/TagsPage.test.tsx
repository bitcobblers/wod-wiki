import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { TagsPage } from './TagsPage';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage';

afterEach(() => {
    cleanup();
    resetStorageForTesting();
});

function renderTags(initialTag?: string, route = '/t/general/heavy') {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <TagsPage initialTag={initialTag} />
        </MemoryRouter>
    );
}

/** Mirrors AppContent's tagDetail wiring: the router param is passed through
 *  verbatim — React Router already decodes it once. */
function TagRouteMirror() {
    const { tag } = useParams();
    return <TagsPage key={tag ?? ''} initialTag={tag} />;
}

function renderTagRoute(route: string) {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <Routes>
                <Route path="/t/:type/:tag" element={<TagRouteMirror />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('TagsPage — the tag editor at /t/:type/:tag', () => {
    beforeEach(async () => {
        setStorageForTesting(new InMemoryStorage());
    });

    it('opens the requested tag in the editor', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags('heavy');

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit heavy' })).toBeTruthy());
    });

    it('opens the tag a ?tag= link points at', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags(undefined, `/t/general/heavy?tag=heavy`);

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit heavy' })).toBeTruthy());
    });

    it('renders a percent-containing tag route without a URIError', async () => {
        // Row/editor links encode '%' as %25; the router decodes the param
        // exactly once. A second decode (decodeURIComponent('%')) throws —
        // the param must be passed through verbatim.
        await storageService.putTag({ id: 'tag-1', label: '50%', createdAt: 1000 });

        renderTagRoute('/t/general/50%25');

        await screen.findByRole('heading', { name: 'Edit 50%' });
    });

    it('resolves a slash-containing label as one route segment', async () => {
        // '%2F' must not split into an extra path segment — the whole
        // decoded label names the edited tag.
        await storageService.putTag({ id: 'tag-1', label: 'a/b', createdAt: 1000 });

        renderTagRoute('/t/general/a%2Fb');

        await screen.findByRole('heading', { name: 'Edit a/b' });
    });

    it('creates a tag and selects it', async () => {
        renderTags();

        const input = await screen.findByPlaceholderText('heavy');
        fireEvent.change(input, { target: { value: 'sprint' } });
        fireEvent.click(screen.getByText('Add Tag'));

        await waitFor(async () => {
            const tags = await storageService.getAllTags();
            expect(tags.map(tag => tag.label)).toEqual(['sprint']);
        }, { timeout: 5000 });
        // The new tag is the edited one.
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit sprint' })).toBeTruthy());
    });

    it('saves the contributions a tag carries', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags('heavy');

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit heavy' })).toBeTruthy());
        fireEvent.click(screen.getByText('Metric'));

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
        }, { timeout: 5000 });
    });

    it('refuses a second tag with the same name', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags('heavy');

        const input = await screen.findByPlaceholderText('heavy');
        fireEvent.change(input, { target: { value: 'heavy' } });
        fireEvent.click(screen.getByText('Add Tag'));

        await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    });

    it('points at the catalogue when no tag is selected', async () => {
        await storageService.putTag({ id: 'tag-1', label: 'heavy', createdAt: 1000 });

        renderTags(undefined, '/t/general/');

        await waitFor(() => expect(screen.getByText(/tag catalogue/)).toBeTruthy());
    });
});
