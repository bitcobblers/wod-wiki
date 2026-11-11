/**
 * Playground / Views / Effort Detail
 *
 * Mounts the real `EffortDetailPage` (`/effort/:slug`) over isolated in-memory
 * domain states (`parameters.domainState`) and asserts the three data-state
 * outcomes via the shared TestIdContract:
 * 1. `BundledEffortReadOnly` — bundled catalog entry rendered read-only with a
 *    `Bundled` source badge.
 * 2. `ScopedPropertyOverrideEffort` — effort whose slug has scoped property
 *    overrides present in storage.
 * 3. `UnresolvedEffortAliasPrompt` — unknown slug falls back to the not-found
 *    prompt offering Create / Link-as-alias.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EffortDetailPage } from '@app/pages/EffortDetailPage';
import { TEST_IDS } from '@/lib/testIds';
import { storyActions } from './testing/storyActions';

const meta: Meta = {
  title: 'Playground/Views/Effort Detail',
  component: EffortDetailPage,
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const BundledEffortReadOnly: StoryObj = {
  parameters: {
    domainState: 'populatedJournal',
    route: '/effort/kettlebell-swing',
    routePath: '/effort/:slug',
    layout: 'fullscreen',
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId(TEST_IDS.EFFORT_DETAIL_ROOT)).resolves.toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL)).toHaveTextContent('Kettlebell Swing');
    await expect(canvas.getByTestId(TEST_IDS.EFFORT_DETAIL_SOURCE)).toHaveTextContent('Bundled');
  },
};

export const ScopedPropertyOverrideEffort: StoryObj = {
  parameters: {
    domainState: 'scopedPropertyOverride',
    route: '/effort/snatch',
    routePath: '/effort/:slug',
    layout: 'fullscreen',
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId(TEST_IDS.EFFORT_DETAIL_ROOT)).resolves.toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL)).toHaveTextContent('Snatch');
  },
};

export const UnresolvedEffortAliasPrompt: StoryObj = {
  parameters: {
    domainState: 'populatedJournal',
    route: '/effort/unknown-kb-movement',
    routePath: '/effort/:slug',
    layout: 'fullscreen',
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId(TEST_IDS.EFFORT_NOT_FOUND)).resolves.toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_CREATE_BTN)).toBeVisible();
    await expect(canvas.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_BTN)).toBeVisible();
  },
};
