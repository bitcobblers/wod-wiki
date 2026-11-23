import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { WodWikiMark, WodWikiWordmark } from '@/components/atoms/WodWikiBrand';

const meta: Meta = {
  title: 'Design System/Brand & Identity',
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj;

const MARK_SIZES = [16, 24, 32, 48, 64] as const;

export const BrandMarkAndWordmark: Story = {
  render: () => (
    <div className="max-w-4xl space-y-6" data-testid="brand-identity-story">
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Executable Fence Mark (Mineral Slate Squircle)
        </h2>
        <div className="flex flex-wrap items-end gap-6">
          {MARK_SIZES.map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <WodWikiMark size={size} />
              <span className="font-mono text-xs text-muted-foreground">{size}px</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-[#f7f5f0] text-[#2c2620] p-6 space-y-4">
          <div className="text-xs font-semibold text-[#574c42]">Mineral Light</div>
          <div className="space-y-4">
            <div>
              <WodWikiWordmark size="sm" />
            </div>
            <div>
              <WodWikiWordmark size="md" />
            </div>
            <div>
              <WodWikiWordmark size="lg" />
            </div>
          </div>
        </div>

        <div className="dark rounded-xl border border-[#3f4859] bg-[#2e3440] text-[#eceff4] p-6 space-y-4">
          <div className="text-xs font-semibold text-[#bac3d1]">Arctic Frost Dark</div>
          <div className="space-y-4">
            <div>
              <WodWikiWordmark size="sm" />
            </div>
            <div>
              <WodWikiWordmark size="md" />
            </div>
            <div>
              <WodWikiWordmark size="lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('brand-identity-story')).toBeVisible();
    await expect(canvas.getAllByText('WOD').length).toBeGreaterThanOrEqual(6);
    await expect(canvas.getAllByText('.wiki').length).toBeGreaterThanOrEqual(6);
  },
};
