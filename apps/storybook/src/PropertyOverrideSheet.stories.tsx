/**
 * Playground / Organisms / PropertyOverrideSheet — scoped property override
 * target picker over the isolated `scopedPropertyOverride` domain state
 * (`parameters.domainState`). The sheet portals into `document.body`, so
 * `play()` scripts query `within(canvasElement.ownerDocument.body)` and
 * assert the persisted `listScopedPropertyOverrides` rows in the story's
 * in-memory storage plane.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { listScopedPropertyOverrides } from '@bitcobblers/wod-wiki-engine';
import { PropertyOverrideSheet } from '@/components/organisms/notebook/PropertyOverrideSheet';
import { storage } from '@/hooks/useBrowserServices';
import { storyActions } from './testing/storyActions';

const SNATCH_DEFINITION = [
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

const openSnatchOverrideSheet = () => (
  <PropertyOverrideSheet
    open
    onOpenChange={() => {}}
    kind="effort"
    slug="snatch"
    label="Snatch"
    rawContent={SNATCH_DEFINITION}
    storageOverride={storage}
  />
);

const meta: Meta<typeof PropertyOverrideSheet> = {
  title: 'Playground/Organisms/PropertyOverrideSheet',
  component: PropertyOverrideSheet,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof PropertyOverrideSheet>;

export const PersonalRuntimeScope: Story = {
  parameters: { domainState: 'scopedPropertyOverride' },
  render: openSnatchOverrideSheet,
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await body.findByTestId('property-override-sheet');
    await expect(within(sheet).getByText('Override Snatch')).toBeVisible();
    // Seeded `notebook/custom` override marks the personal runtime row Active
    await waitFor(() => {
      expect(body.getByTestId('override-target-notebook/custom')).toHaveTextContent('Active');
    });
    // Writable user notebook `Barbell Club` is offered; read-only subscribed feed notebook `olympic-lifting` is excluded
    await expect(body.findByTestId('override-target-notebook/barbell-club')).resolves.not.toHaveTextContent('Overridden');
    expect(body.queryByTestId('override-target-notebook/olympic-lifting')).toBeNull();
  },
};

export const SelectUserNotebookScope: Story = {
  parameters: { domainState: 'scopedPropertyOverride' },
  render: () => {
    function SelectScopeStory() {
      const [savedTarget, setSavedTarget] = useState<string | null>(null);
      return (
        <>
          <PropertyOverrideSheet
            open
            onOpenChange={() => {}}
            kind="effort"
            slug="snatch"
            label="Snatch"
            rawContent={SNATCH_DEFINITION}
            storageOverride={storage}
            onSaved={(targetNotebookId) => setSavedTarget(targetNotebookId)}
          />
          {savedTarget && <div data-testid="override-saved-target">{savedTarget}</div>}
        </>
      );
    }
    return <SelectScopeStory />;
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const barbellClub = await body.findByTestId('override-target-notebook/barbell-club');
    await expect(barbellClub).not.toHaveTextContent('Overridden');

    await storyActions.selectOverrideScope(body, 'notebook/barbell-club');

    // Saved target reported to the host...
    await waitFor(() => {
      expect(within(canvasElement).getByTestId('override-saved-target')).toHaveTextContent('notebook/barbell-club');
    });
    // ...and the scoped override row persisted in the story's storage plane
    await waitFor(async () => {
      const overrides = await listScopedPropertyOverrides(storage, { kind: 'effort', slug: 'snatch' });
      expect(overrides).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            notebookId: 'notebook/barbell-club',
            kind: 'effort',
            slug: 'snatch',
            label: 'Power Snatch Override',
            rawContent: expect.stringContaining('# Power Snatch Override'),
          }),
        ]),
      );
    });
  },
};
