/**
 * Results Display Versions Gallery
 *
 * Demonstrates the different ways workout execution results are displayed
 * across playground surfaces, ending with the proposed standardized NoteSessionLedger:
 *
 * 1. Playground Note List (PlaygroundNotePage ad-hoc footer)
 * 2. Journal Inlay Row (ResultListItem)
 * 3. Whiteboard Companion Summary (active editor gutter)
 * 4. Session Stream Card (/sessions activity feed)
 * 5. Telemetry Segment Table (/results/:sessionId split breakdown)
 * 6. Proposed Standard Ledger (unified block-attributed history)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResultListItem } from '@/components/molecules/ResultListItem';
import { formatDurationSmart } from '@/lib/formatTime';
import { formatDateShort } from '@/lib/dateFormat';
import { Trophy, History, Clock, CheckCircle2, ChevronRight } from 'lucide-react';

const meta: Meta = {
  title: 'Gallery/Result Display Versions',
  parameters: { layout: 'padded' },
};
export default meta;

const SAMPLE_SESSION = {
  id: 'sess-fran-01',
  noteId: 'note-uuid-123',
  blockId: 'blk-fran',
  duration: 225_000, // 3m 45s
  createdAt: 1774000000000,
  completed: true,
  title: 'Fran',
  prescription: '21-15-9 Thrusters / Pull-ups',
  segments: [
    { round: 1, split: '01:40', cumulative: '01:40', pace: 'Fast' },
    { round: 2, split: '01:15', cumulative: '02:55', pace: 'Steady' },
    { round: 3, split: '00:50', cumulative: '03:45', pace: 'Sprint' },
  ],
};

const SAMPLE_PARTIAL = {
  id: 'sess-fran-02',
  noteId: 'note-uuid-123',
  blockId: 'blk-fran',
  duration: 120_000,
  createdAt: 1773900000000,
  completed: false,
  title: 'Fran',
  prescription: '21-15-9 Thrusters / Pull-ups',
};

// ── Version 1: Playground Note Ad-Hoc List ──
function PlaygroundNoteListCard() {
  const sessions = [SAMPLE_SESSION, SAMPLE_PARTIAL];
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
        Source: /playground/:id (PlaygroundNotePage)
      </div>
      <section aria-label="Workout results">
        <h2 className="text-sm font-semibold text-muted-foreground">Results</h2>
        <ul className="mt-1 divide-y divide-border/60">
          {sessions.map((result) => (
            <li key={result.id}>
              <a
                href={`#/results/${result.id}`}
                className="flex items-center gap-2 py-1.5 text-sm hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                <span className="font-mono">{formatDurationSmart(result.duration)}</span>
                <span className="text-muted-foreground">
                  {formatDateShort(new Date(result.createdAt))}
                </span>
                {!result.completed && (
                  <span className="text-muted-foreground/70 text-xs px-1.5 py-0.5 rounded bg-muted">
                    partial
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Version 2: Journal Inlay Row (ResultListItem) ──
function JournalResultRowCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl flex flex-col gap-2">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">
        Source: /journal/:date &amp; CodeMirror Inlay (ResultListItem)
      </div>
      <ResultListItem
        timeLabel="10:30 AM"
        title="Fran"
        subtitle="21-15-9 Thrusters / Pull-ups · 03:45"
        onClick={() => {}}
      />
      <ResultListItem
        timeLabel="07:15 AM"
        title="Morning Warmup"
        subtitle="5:00 Row / Mobility · 05:00"
        onClick={() => {}}
      />
    </div>
  );
}

// ── Version 3: Companion Block Summary ──
function CompanionBlockSummaryCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
        Source: WhiteboardCompanion (Active Editor Gutter)
      </div>
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
            <History className="h-3 w-3" />
            <span>2 runs</span>
          </div>
          <span className="text-xs font-medium text-emerald-500">PR 03:45</span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">Latest: 03:45 · Fran</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50">
          <span className="font-mono text-foreground">03:45</span>
          <span className="text-muted-foreground">{formatDateShort(new Date(SAMPLE_SESSION.createdAt))}</span>
        </div>
        <div className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 text-muted-foreground">
          <span className="font-mono">02:00 (partial)</span>
          <span>{formatDateShort(new Date(SAMPLE_PARTIAL.createdAt))}</span>
        </div>
      </div>
    </div>
  );
}

// ── Version 4: Session Stream Card ──
function SessionStreamCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
        Source: /sessions &amp; StreamFeed (LibraryRow Card)
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border/50 bg-background hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <Trophy className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">Fran</span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                03:45
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">
              Playground note · Oct 12 · 21-15-9 Thrusters
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="text-xs px-2.5 py-1 rounded border border-border hover:bg-accent text-foreground">
            Compare
          </button>
          <button className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium">
            View
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Version 5: Telemetry Segment Table ──
function SegmentTelemetryTableCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
        Source: /results/:sessionId (PropertyTable / Segment Breakdown)
      </div>
      <div className="border border-border rounded-md overflow-hidden text-xs">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border text-muted-foreground">
              <th className="p-2 text-left font-medium">Round</th>
              <th className="p-2 text-left font-medium">Split</th>
              <th className="p-2 text-left font-medium">Cumulative</th>
              <th className="p-2 text-left font-medium">Pace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 font-mono">
            {SAMPLE_SESSION.segments.map((seg) => (
              <tr key={seg.round} className="hover:bg-muted/30">
                <td className="p-2">Round {seg.round}</td>
                <td className="p-2 text-foreground font-semibold">{seg.split}</td>
                <td className="p-2 text-muted-foreground">{seg.cumulative}</td>
                <td className="p-2 text-emerald-500">{seg.pace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Version 6: Proposed Standardized NoteSessionLedger ──
function ProposedStandardLedgerCard() {
  // ponytail: inline preview of proposed unified component; extract to @/components/organisms/ledger when adopted.
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-xl shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <h3 className="text-sm font-semibold text-foreground">Workout History &amp; Results</h3>
        </div>
        <span className="text-xs text-muted-foreground font-mono">2 runs recorded</span>
      </div>

      <div className="space-y-3">
        {/* Block Header */}
        <div className="rounded-md border border-border/70 bg-background/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/50 text-xs">
            <span className="font-semibold text-foreground">Block: Fran (21-15-9)</span>
            <span className="text-muted-foreground font-mono">Best: 03:45</span>
          </div>
          <div className="divide-y divide-border/40">
            <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">03:45</span>
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      PR
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateShort(new Date(SAMPLE_SESSION.createdAt))} · 3 rounds completed
                  </div>
                </div>
              </div>
              <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                <span>Splits</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors opacity-70">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-sm">02:00</span>
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                      Stopped
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateShort(new Date(SAMPLE_PARTIAL.createdAt))} · Stopped early
                  </div>
                </div>
              </div>
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                <span>Details</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stories ──

export const AllVersionsComparison: StoryObj = {
  render: () => (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1">Workout Results Display Gallery</h1>
        <p className="text-sm text-muted-foreground">
          Comparison of the 5 divergent ways workout results are presented across playground screens today,
          concluding with the proposed unified <code>NoteSessionLedger</code> component.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-amber-500 mb-2">1. Current /playground Detail List</h2>
          <PlaygroundNoteListCard />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-emerald-500 mb-2">2. Journal / Inlay Row (ResultListItem)</h2>
          <JournalResultRowCard />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-sky-500 mb-2">3. Whiteboard Companion Summary</h2>
          <CompanionBlockSummaryCard />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-purple-500 mb-2">4. /sessions Activity Card</h2>
          <SessionStreamCard />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-indigo-500 mb-2">5. Telemetry Segment Split Table</h2>
          <SegmentTelemetryTableCard />
        </div>

        <div className="pt-4 border-t border-border">
          <h2 className="text-sm font-semibold text-primary mb-2">6. Proposed Unified NoteSessionLedger</h2>
          <ProposedStandardLedgerCard />
        </div>
      </div>
    </div>
  ),
};

export const PlaygroundNoteList: StoryObj = {
  render: () => <PlaygroundNoteListCard />,
};

export const JournalResultListItem: StoryObj = {
  render: () => <JournalResultRowCard />,
};

export const CompanionBlockSummary: StoryObj = {
  render: () => <CompanionBlockSummaryCard />,
};

export const SessionStreamCardView: StoryObj = {
  render: () => <SessionStreamCard />,
};

export const SegmentTelemetryTable: StoryObj = {
  render: () => <SegmentTelemetryTableCard />,
};

export const ProposedStandardLedger: StoryObj = {
  render: () => <ProposedStandardLedgerCard />,
};
