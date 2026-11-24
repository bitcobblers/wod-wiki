import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

interface TokenSpec {
  name: string;
  cssVar: string;
  role: string;
  isDirectColor?: boolean;
}

const SURFACE_TOKENS: TokenSpec[] = [
  { name: 'Background', cssVar: '--background', role: 'Primary app canvas surface' },
  { name: 'Foreground', cssVar: '--foreground', role: 'Primary body typography' },
  { name: 'Card', cssVar: '--card', role: 'Elevated container / panel surface' },
  { name: 'Popover', cssVar: '--popover', role: 'Floating menu & dialog surface' },
  { name: 'Muted', cssVar: '--muted', role: 'Subtle background / secondary well' },
  { name: 'Muted Foreground', cssVar: '--muted-foreground', role: 'De-emphasized captions & labels' },
  { name: 'Primary', cssVar: '--primary', role: 'Primary interactive accent (Mineral Slate / Frost Blue)' },
  { name: 'Secondary', cssVar: '--secondary', role: 'Secondary button & chip surface' },
  { name: 'Accent', cssVar: '--accent', role: 'Highlight & hover surface (Ochre / Aurora)' },
  { name: 'Border', cssVar: '--border', role: 'Structural hairlines & card borders' },
  { name: 'Field Border', cssVar: '--field-border', role: 'Interactive input boundary (>= 3:1 WCAG 1.4.11)' },
  { name: 'Field Placeholder', cssVar: '--field-placeholder', role: 'Input placeholder text (>= 4.5:1 WCAG 1.4.3)' },
  { name: 'Ring', cssVar: '--ring', role: 'Keyboard focus-visible outline' },
];

const SEMANTIC_TOKENS: TokenSpec[] = [
  { name: 'Success', cssVar: '--success', role: 'Completed sessions, saved confirmations' },
  { name: 'Warning', cssVar: '--warning', role: 'Caution badges, non-blocking diagnostics' },
  { name: 'Destructive', cssVar: '--destructive', role: 'Delete actions, validation errors' },
  { name: 'Signal Positive', cssVar: '--signal-positive', role: 'PR indicators, valid WQL, goal reached' },
  { name: 'Signal Caution', cssVar: '--signal-caution', role: 'Paused timer, caution zone band' },
  { name: 'Signal Negative', cssVar: '--signal-negative', role: 'Parse errors, stop action, high-HR zone' },
];

const METRIC_TOKENS: TokenSpec[] = [
  { name: 'Time / Duration', cssVar: '--metric-time', role: 'Timers, EMOM windows, :60 durations' },
  { name: 'Rep', cssVar: '--metric-rep', role: 'Repetition counts (21, 15, 9)' },
  { name: 'Effort', cssVar: '--metric-effort', role: 'Movements (Thrusters, Pull-ups, Run)' },
  { name: 'Rounds', cssVar: '--metric-rounds', role: 'Round brackets (5) & rep schemes (21-15-9)' },
  { name: 'Distance', cssVar: '--metric-distance', role: 'Meters, miles, calories (400m, 1 Mile)' },
  { name: 'Resistance / Load', cssVar: '--metric-resistance', role: 'Weights & percentages (@95lb, 24kg, 80%)' },
  { name: 'Action', cssVar: '--metric-action', role: 'Structural modifiers & lap markers (+)' },
  { name: 'Rest', cssVar: '--metric-rest', role: 'Forced rest intervals (*:30 Rest)' },
  { name: 'Equipment', cssVar: '--metric-equipment', role: 'Gear references (Barbell, Kettlebell)' },
];

const DATAVIZ_TOKENS: TokenSpec[] = [
  { name: 'RPE Easy', cssVar: '--color-rpe-easy', role: 'Low perceived exertion (1-4)', isDirectColor: true },
  { name: 'RPE Moderate', cssVar: '--color-rpe-moderate', role: 'Moderate exertion (5-6)', isDirectColor: true },
  { name: 'RPE Hard', cssVar: '--color-rpe-hard', role: 'High exertion (7-8)', isDirectColor: true },
  { name: 'RPE Max', cssVar: '--color-rpe-max', role: 'Maximal effort (9-10)', isDirectColor: true },
  { name: 'Type: Segment', cssVar: '--color-type-segment', role: 'Output statement segment dot', isDirectColor: true },
  { name: 'Type: Milestone', cssVar: '--color-type-milestone', role: 'Output statement milestone dot', isDirectColor: true },
  { name: 'Type: Completion', cssVar: '--color-type-completion', role: 'Output statement completion dot', isDirectColor: true },
  { name: 'Type: Metric', cssVar: '--color-type-metric', role: 'Output statement metric dot', isDirectColor: true },
  { name: 'Type: Event', cssVar: '--color-type-event', role: 'Output statement event dot', isDirectColor: true },
  { name: 'Type: Group', cssVar: '--color-type-group', role: 'Output statement group dot', isDirectColor: true },
  { name: 'Type: Analytics', cssVar: '--color-type-analytics', role: 'Output statement analytics dot', isDirectColor: true },
  { name: 'Brand Slate', cssVar: '--color-brand', role: 'Primary brand tile', isDirectColor: true },
];

const RADIUS_TOKENS = [
  { name: 'Small', cssVar: '--radius-sm', note: '4px — inline metric tags' },
  { name: 'UI Control', cssVar: '--ui-radius', note: '8px — buttons, inputs, selects' },
  { name: 'Medium', cssVar: '--radius-md', note: '14px — nested panels' },
  { name: 'Large', cssVar: '--radius-lg', note: '16px — cards & dialogs' },
  { name: 'XL', cssVar: '--radius-xl', note: '20px — featured panels' },
  { name: 'Pill', cssVar: '--radius-pill', note: '9999px — badges & chips' },
];

function SwatchGrid({ title, subtitle, tokens }: { title: string; subtitle: string; tokens: TokenSpec[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tokens.map((t) => (
          <div
            key={t.cssVar}
            data-testid={`token-swatch-${t.cssVar.replace(/^--/, '')}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div
              className="size-10 rounded-lg border border-border/80 shrink-0"
              style={{ backgroundColor: t.isDirectColor ? `var(${t.cssVar})` : `hsl(var(${t.cssVar}))` }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-foreground truncate">{t.name}</div>
              <code className="text-xs font-mono text-primary block truncate">{t.cssVar}</code>
              <div className="text-xs text-muted-foreground truncate">{t.role}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface DesignTokensShowcaseProps {
  showSurfaces?: boolean;
  showSemantic?: boolean;
  showMetrics?: boolean;
  showDataViz?: boolean;
  showTypography?: boolean;
  showShapes?: boolean;
}

function DesignTokensShowcase({
  showSurfaces = true,
  showSemantic = true,
  showMetrics = true,
  showDataViz = true,
  showTypography = true,
  showShapes = true,
}: DesignTokensShowcaseProps) {
  return (
    <div className="max-w-5xl space-y-8" data-testid="design-tokens-page">
      <header className="border-b border-border pb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Design Tokens — Mineral &amp; Arctic Frost
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Canonical tokens from <code>packages/ui/src/styles.css</code> and <code>DESIGN.md</code>. Switch the <strong>Theme</strong> toolbar between Mineral (Light) and Arctic Frost (Dark) to inspect live CSS custom property resolution on <code>&lt;html&gt;</code>.
        </p>
      </header>

      {showSurfaces && (
        <SwatchGrid
          title="Base & Chrome Surfaces"
          subtitle="Core canvas, elevated surfaces, borders, and WCAG-calibrated field boundaries"
          tokens={SURFACE_TOKENS}
        />
      )}

      {showSemantic && (
        <SwatchGrid
          title="Status & Signal Accents"
          subtitle="Semantic feedback states and high-contrast chart/validity signals"
          tokens={SEMANTIC_TOKENS}
        />
      )}

      {showMetrics && (
        <SwatchGrid
          title="Whiteboard Metric Semantic Palette"
          subtitle="Every parsed IMetric fragment maps deterministically to one of 9 WCAG AA semantic tokens"
          tokens={METRIC_TOKENS}
        />
      )}

      {showDataViz && (
        <SwatchGrid
          title="RPE, Statement Types & Brand"
          subtitle="Palette-independent data-visualization hues and brand mark tokens"
          tokens={DATAVIZ_TOKENS}
        />
      )}

      {showTypography && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Typography &amp; Metric Pills</h2>
            <p className="text-xs text-muted-foreground">
              UI uses <code>font-sans</code> (Geist Sans); long-form guides use <code>font-serif</code> (Newsreader); scripts, WQL queries, and timers use <code>font-mono</code> (JetBrains Mono) with <code>tabular-nums</code>.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: '(21-15-9) Rounds', dot: 'bg-metric-rounds', border: 'border-metric-rounds/50' },
                { label: '21 Reps', dot: 'bg-metric-rep', border: 'border-metric-rep/50' },
                { label: 'Thrusters', dot: 'bg-metric-effort', border: 'border-metric-effort/50' },
                { label: '@95lb', dot: 'bg-metric-resistance', border: 'border-metric-resistance/50' },
                { label: '10:00 EMOM', dot: 'bg-metric-time', border: 'border-metric-time/50' },
                { label: '400m', dot: 'bg-metric-distance', border: 'border-metric-distance/50' },
                { label: '*:30 Rest', dot: 'bg-metric-rest', border: 'border-metric-rest/50' },
                { label: 'Barbell', dot: 'bg-metric-equipment', border: 'border-metric-equipment/50' },
              ].map((pill) => (
                <span
                  key={pill.label}
                  className={`inline-flex items-center gap-1.5 rounded-md border ${pill.border} bg-background px-2.5 py-1 font-mono text-xs font-semibold text-foreground`}
                >
                  <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden="true" />
                  {pill.label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-3 border-t border-border/60">
              <div>
                <div className="text-xs font-mono uppercase text-muted-foreground">Hero Timer (tabular-nums)</div>
                <div className="font-mono text-4xl font-black tabular-nums tracking-tight text-foreground">03:45.8</div>
              </div>
              <div>
                <div className="text-xs font-mono uppercase text-muted-foreground">Editorial Serif (Newsreader)</div>
                <p className="font-serif text-lg text-foreground leading-snug mt-1">
                  Write workouts as Markdown. Run them on a clock.
                </p>
              </div>
              <div>
                <div className="text-xs font-mono uppercase text-muted-foreground">WQL Expression</div>
                <code className="font-mono text-xs text-primary block mt-1 break-all">
                  :journal&#123;effort:thruster&#125; last 8w | :sum&#123;metric:volume&#125;
                </code>
              </div>
            </div>
          </div>
        </section>
      )}

      {showShapes && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Shapes &amp; Radii</h2>
            <p className="text-xs text-muted-foreground">
              Corner radius vocabulary from compact metric tags to pill badges
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {RADIUS_TOKENS.map((r) => (
              <div key={r.cssVar} className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div
                  className="h-10 w-full border border-field-border bg-muted"
                  style={{ borderRadius: `var(${r.cssVar})` }}
                />
                <div className="text-xs font-semibold text-foreground">{r.name}</div>
                <code className="text-xs font-mono text-primary block">{r.cssVar}</code>
                <div className="text-xs text-muted-foreground">{r.note}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const meta: Meta<typeof DesignTokensShowcase> = {
  title: 'Design System/Design Tokens',
  component: DesignTokensShowcase,
  parameters: {
    a11y: { test: 'error' },
  },
  args: {
    showSurfaces: true,
    showSemantic: true,
    showMetrics: true,
    showDataViz: true,
    showTypography: true,
    showShapes: true,
  },
  argTypes: {
    showSurfaces: { control: 'boolean', description: 'Show Base & Chrome surface tokens' },
    showSemantic: { control: 'boolean', description: 'Show Status & Signal accent tokens' },
    showMetrics: { control: 'boolean', description: 'Show the 9 Whiteboard Language metric color tokens' },
    showDataViz: { control: 'boolean', description: 'Show RPE ramp, statement type, and brand tokens' },
    showTypography: { control: 'boolean', description: 'Show typography and metric pill specimens' },
    showShapes: { control: 'boolean', description: 'Show corner radius tokens' },
  },
};

export default meta;
type Story = StoryObj<typeof DesignTokensShowcase>;

export const PaletteAndTypography: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('design-tokens-page')).toBeInTheDocument();
    await expect(canvas.getByTestId('token-swatch-primary')).toBeInTheDocument();
    await expect(canvas.getByTestId('token-swatch-metric-effort')).toBeInTheDocument();
    await expect(canvas.getByTestId('token-swatch-field-border')).toBeInTheDocument();
    const bgToken = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    await expect(bgToken.length).toBeGreaterThan(0);
  },
};

export const DarkArcticFrost: Story = {
  globals: {
    theme: 'dark',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('design-tokens-page')).toBeInTheDocument();
    await expect(document.documentElement.classList.contains('dark')).toBe(true);
  },
};
