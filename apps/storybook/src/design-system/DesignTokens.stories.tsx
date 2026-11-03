import type { Meta, StoryObj } from '@storybook/react-vite';

interface TokenSpec {
  name: string;
  cssVar: string;
  role: string;
}

const SURFACE_TOKENS: TokenSpec[] = [
  { name: 'Background', cssVar: '--background', role: 'Primary app canvas surface' },
  { name: 'Foreground', cssVar: '--foreground', role: 'Primary body typography' },
  { name: 'Card', cssVar: '--card', role: 'Elevated container / panel surface' },
  { name: 'Muted', cssVar: '--muted', role: 'Subtle background / secondary well' },
  { name: 'Muted Foreground', cssVar: '--muted-foreground', role: 'De-emphasized captions & labels' },
  { name: 'Primary', cssVar: '--primary', role: 'Primary interactive accent (Slate / Frost Blue)' },
  { name: 'Secondary', cssVar: '--secondary', role: 'Secondary button & chip surface' },
  { name: 'Accent', cssVar: '--accent', role: 'Highlight & hover surface (Ochre / Aurora)' },
  { name: 'Border', cssVar: '--border', role: 'Structural hairlines & card borders' },
];

const SEMANTIC_TOKENS: TokenSpec[] = [
  { name: 'Success / Signal Positive', cssVar: '--signal-positive', role: 'Completed state, valid WQL, PR indicators' },
  { name: 'Warning / Signal Caution', cssVar: '--signal-caution', role: 'Paused timer, caution zone band' },
  { name: 'Destructive / Signal Negative', cssVar: '--signal-negative', role: 'Parse errors, stop action, high-HR zone' },
];

const METRIC_TOKENS: TokenSpec[] = [
  { name: 'Time / Duration', cssVar: '--metric-time', role: 'Timers, EMOM windows, `:60` durations' },
  { name: 'Rep', cssVar: '--metric-rep', role: 'Repetition counts (`21`, `15`, `9`)' },
  { name: 'Effort', cssVar: '--metric-effort', role: 'Movements (`Thrusters`, `Pull-ups`, `Run`)' },
  { name: 'Rounds', cssVar: '--metric-rounds', role: 'Round brackets `(5)` & rep schemes `(21-15-9)`' },
  { name: 'Distance', cssVar: '--metric-distance', role: 'Meters, miles, calories (`400m`, `1 Mile`)' },
  { name: 'Resistance / Load', cssVar: '--metric-resistance', role: 'Weights & percentages (`@95lb`, `24kg`, `80%`)' },
  { name: 'Action', cssVar: '--metric-action', role: 'Structural modifiers &lap markers (`+`)' },
  { name: 'Rest', cssVar: '--metric-rest', role: 'Forced rest intervals (`*:30 Rest`)' },
  { name: 'Equipment', cssVar: '--metric-equipment', role: 'Gear references (`Barbell`, `Kettlebell`)' },
];

function SwatchGrid({ title, subtitle, tokens }: { title: string; subtitle: string; tokens: TokenSpec[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tokens.map((t) => (
          <div
            key={t.cssVar}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-2xs"
          >
            <div
              className="size-10 rounded-lg border border-border/80 shrink-0 shadow-inner"
              style={{ backgroundColor: `hsl(var(${t.cssVar}))` }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-foreground truncate">{t.name}</div>
              <code className="text-[11px] font-mono text-primary block truncate">{t.cssVar}</code>
              <div className="text-[11px] text-muted-foreground truncate">{t.role}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DesignTokensShowcase({ showMetrics = true, showTypography = true }: { showMetrics?: boolean; showTypography?: boolean }) {
  return (
    <div className="max-w-5xl space-y-8" data-testid="design-tokens-page">
      <header className="border-b border-border pb-4">
        <h1 className="text-xl font-black tracking-tight text-foreground">
          Design Tokens — Mineral &amp; Arctic Frost
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Switch the <strong>Theme</strong> toolbar between Light (Mineral) and Dark (Arctic Frost) to inspect live CSS custom property resolution on <code>&lt;html&gt;</code>.
        </p>
      </header>

      <SwatchGrid
        title="1. Base & Chrome Surfaces"
        subtitle="Core layout, card, and border tokens from @bitcobblers/wod-wiki-ui/styles.css"
        tokens={SURFACE_TOKENS}
      />

      <SwatchGrid
        title="2. Status & Signal Tokens"
        subtitle="High-contrast status hues for validation, charts, and execution alerts"
        tokens={SEMANTIC_TOKENS}
      />

      {showMetrics && (
        <SwatchGrid
          title="3. Whiteboard Metric Semantic Palette"
          subtitle="Every parsed IMetric fragment maps deterministically to one of 9 semantic tokens"
          tokens={METRIC_TOKENS}
        />
      )}

      {showTypography && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">4. Typography &amp; Metric Pills</h3>
            <p className="text-xs text-muted-foreground">
              UI prose uses <code>font-sans</code> (Inter); scripts, WQL queries, and timers use <code>font-mono</code> (JetBrains Mono) with <code>tabular-nums</code>.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-metric-rounds/40 bg-metric-rounds/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-rounds">
                (21-15-9) Rounds
              </span>
              <span className="rounded-md border border-metric-rep/40 bg-metric-rep/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-rep">
                21 Reps
              </span>
              <span className="rounded-md border border-metric-effort/40 bg-metric-effort/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-effort">
                Thrusters
              </span>
              <span className="rounded-md border border-metric-resistance/40 bg-metric-resistance/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-resistance">
                @95lb
              </span>
              <span className="rounded-md border border-metric-time/40 bg-metric-time/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-time">
                10:00 EMOM
              </span>
              <span className="rounded-md border border-metric-distance/40 bg-metric-distance/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-distance">
                400m
              </span>
              <span className="rounded-md border border-metric-rest/40 bg-metric-rest/15 px-2.5 py-1 font-mono text-xs font-semibold text-metric-rest">
                *:30 Rest
              </span>
            </div>
            <div className="flex items-baseline gap-6 pt-2 border-t border-border/60">
              <div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Hero Timer (tabular-nums)</div>
                <div className="font-mono text-4xl font-black tabular-nums tracking-tight text-foreground">03:45.8</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">WQL Expression</div>
                <code className="font-mono text-sm text-primary">:journal&#123;effort:thruster&#125; last 8w | :sum&#123;metric:volume&#125;</code>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const meta: Meta<typeof DesignTokensShowcase> = {
  title: 'Design System/Design Tokens',
  component: DesignTokensShowcase,
  args: {
    showMetrics: true,
    showTypography: true,
  },
  argTypes: {
    showMetrics: { control: 'boolean', description: 'Show the 9 Whiteboard Language metric color tokens' },
    showTypography: { control: 'boolean', description: 'Show typography and metric pill specimens' },
  },
};

export default meta;
type Story = StoryObj<typeof DesignTokensShowcase>;

export const PaletteAndTypography: Story = {};
