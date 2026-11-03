/**
 * WQL Example Gallery — the canonical live WQL showcase (wayfinder map:
 * analytics-widget-gallery).
 *
 * One story per section: every card executes its query live through
 * QueryService over the seeded corpus journals
 * (`inMemoryEventStore` → QueryService → renderer), rendered the way the
 * query defines it. The manifest driving the sections lives in
 * `./gallery/galleryManifest.ts` with a mechanical coverage guard in
 * `test/galleryManifest.test.ts`.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { GallerySectionView } from './gallery/GalleryCard';
import type { GallerySection } from './gallery/galleryManifest';

const meta: Meta = {
  id: 'gallery-wql-example-gallery',
  title: 'Packages/UI/Blocks/WQL Example Gallery',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

/** One story per section — the Storybook sidebar is the gallery index. */
function sectionStory(section: GallerySection): Story {
  return { render: () => <GallerySectionView section={section} /> };
}

export const AutoInference: Story = sectionStory('auto');
export const ValueSection: Story = sectionStory('value');
export const TimeseriesSection: Story = sectionStory('timeseries');
export const BarSection: Story = sectionStory('bar');
export const TopListSection: Story = sectionStory('toplist');
export const StackedBarSection: Story = sectionStory('stacked-bar');
export const GoalRingsSection: Story = sectionStory('goal-rings');
export const ZoneDistributionSection: Story = sectionStory('zone-distribution');
export const TableSection: Story = sectionStory('table');
export const RowsFindSection: Story = sectionStory('rows');
export const FindSection: Story = sectionStory('find');
export const EdgeStatesSection: Story = sectionStory('edge');
