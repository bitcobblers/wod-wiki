import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ResultListItem } from '@/components/molecules/ResultListItem';
import { WorkoutActionButton } from '@/components/molecules/WorkoutActionButton';
import { Button } from '@/components/atoms/primitives/button';
import { Badge } from '@/components/atoms/primitives/badge';

const meta: Meta<typeof ResultListItem> = {
  title: 'Playground/Molecules/ResultListItem',
  component: ResultListItem,
  args: {
    timeLabel: '10:30 AM',
    title: 'Benchmark — Fran',
    subtitle: '21-15-9 Thrusters @95lb / Pull-ups · 03:45',
    onClick: fn(),
  },
  argTypes: {
    timeLabel: { control: 'text', description: 'Formatted wall-clock timestamp' },
    title: { control: 'text', description: 'Primary workout or note title' },
    subtitle: { control: 'text', description: 'Prescription summary & duration' },
  },
  render: (args) => (
    <div className="max-w-xl rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden shadow-2xs">
      <ResultListItem {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof ResultListItem>;

export const SingleResultRow: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /Benchmark — Fran/i });
    await expect(button).toBeVisible();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const MultipleDayResults: Story = {
  render: (args) => (
    <div className="max-w-xl rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden shadow-2xs">
      <ResultListItem {...args} />
      <ResultListItem
        timeLabel="07:15 AM"
        title="Morning Mobility & Easy Row"
        subtitle="5:00 Row / Couch Stretch · 12:00"
        onClick={args.onClick}
      />
      <ResultListItem
        timeLabel="05:45 PM"
        title="Back Squat 5x5"
        subtitle="5 Sets × 5 Reps @ 315 lb · 18:20"
        onClick={args.onClick}
      />
    </div>
  ),
};

export const PrimitivesAndActionButtons: StoryObj = {
  render: () => (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Playground Button Variants
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default">Primary Action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Badges &amp; WorkoutActionButton (Date Picker Dropdown)
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="default">Active</Badge>
          <Badge variant="secondary">Rounds</Badge>
          <Badge variant="outline">v0.11.0</Badge>
          <WorkoutActionButton
            mode="create"
            label="Schedule Workout"
            onAction={() => {}}
          />
          <WorkoutActionButton
            mode="clone"
            label="Clone to Date"
            onAction={() => {}}
          />
        </div>
      </section>
    </div>
  ),
};
