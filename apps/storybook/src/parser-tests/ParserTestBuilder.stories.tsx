import type { Meta, StoryObj } from '@storybook/react-vite';
import { ParserTestBuilder } from './ParserTestBuilder';

const meta: Meta<typeof ParserTestBuilder> = {
  id: 'parsertests-test-builder',
  title: 'Workbench/Parser Tests/Test Builder',
  component: ParserTestBuilder,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ParserTestBuilder>;

/** Author cases against a benchmark script; seed expectations from the parser, then curate. */
export const BuildGoldenCase: Story = {
  args: {
    initialScript: '(21-15-9)\n  Thrusters 95lb\n  Pull-ups\n',
    fileTitle: 'parser-tests',
  },
};

/** Blank-ish start: type any script and the parser fills the expectation table. */
export const FromScratch: Story = {};
