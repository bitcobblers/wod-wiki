import type { Meta, StoryObj } from '@storybook/react-vite';
import { ParserTestRunner } from './ParserTestRunner';

const meta: Meta<typeof ParserTestRunner> = {
  title: 'ParserTests/Runner',
  component: ParserTestRunner,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ParserTestRunner>;

/**
 * Template component: every story points `jsonPath` at a different dataset
 * under `apps/storybook/public/parser-tests/`. Drop a new JSON file there
 * and add a story — no code changes.
 */
export const GoldenCatalog: Story = {
  args: { jsonPath: 'parser-tests/notebook.json' },
};

/** Dialect-heavy spot checks (climb, unit fusion) split into a second dataset. */
export const DialectSpotChecks: Story = {
  args: { jsonPath: 'parser-tests/dialect.json' },
};

/** Missing file: shows the runner's error surface. */
export const MissingDataset: Story = {
  args: { jsonPath: 'parser-tests/does-not-exist.json' },
};
