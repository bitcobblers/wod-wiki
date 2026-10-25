import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import noteEditorData from './data/note-editor';
import journalDateStackData from './data/journal-date-stack';
import journalStreamData from './data/journal-stream.json';
import collectionLandingData from './data/collection-landing.json';
import effortDetailData from './data/effort-detail.json';
import sessionDetailData from './data/session-detail';
import dashboardViewData from './data/dashboard-view.json';
import wallClockData from './data/wall-clock.json';
import {
  BookOpen,
  Calendar,
  Dumbbell,
  Play,
  CalendarPlus,
  Edit3,
  Eye,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

const meta: Meta = {
  title: 'Screens',
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;

// ── 1. Universal Note Editor ──────────────────────────────────────────────────
function UniversalNoteEditorView() {
  const [mode, setMode] = useState<'read' | 'edit'>('edit');
  const { note } = noteEditorData;

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans">
        {/* Left Icon Rail (Desktop ≥1024px) */}
        <aside className="hidden lg:flex w-14 flex-col items-center py-4 border-r border-border bg-muted/20 shrink-0">
          <div className="size-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-black mb-6">
            W
          </div>
          <nav className="flex flex-col gap-4 text-muted-foreground">
            <button className="p-2 hover:text-foreground rounded-md transition-colors"><BookOpen className="size-5" /></button>
            <button className="p-2 hover:text-foreground rounded-md transition-colors"><Calendar className="size-5" /></button>
            <button className="p-2 hover:text-foreground rounded-md transition-colors"><Dumbbell className="size-5" /></button>
          </nav>
        </aside>

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Desktop Sticky Header (Hidden on Mobile) */}
          <header className="hidden lg:flex items-center justify-between px-6 py-3 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
            <div>
              <div className="text-xs text-muted-foreground hover:underline cursor-pointer">Journal</div>
              <h1 className="text-lg font-bold">{note.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex border border-border rounded-lg p-0.5 bg-muted/40 text-xs font-medium">
                <button
                  onClick={() => setMode('read')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${mode === 'read' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
                >
                  <Eye className="size-3.5" /> Read
                </button>
                <button
                  onClick={() => setMode('edit')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${mode === 'edit' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
                >
                  <Edit3 className="size-3.5" /> Edit
                </button>
              </div>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors">
                <CalendarPlus className="size-3.5" /> Add to Today
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity">
                <Play className="size-3.5 fill-current" /> Run
              </button>
            </div>
          </header>

          {/* Mobile Top Navbar (Hidden on Desktop) */}
          <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <ChevronLeft className="size-5 text-muted-foreground" />
              <span className="font-semibold text-sm truncate">{note.title}</span>
            </div>
            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">Note</span>
          </div>

          {/* Content Body */}
          <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-4">
            <div className="flex gap-2 mb-2">
              {(note.tags ?? []).map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  #t
                </span>
              ))}
            </div>

            <div className="border border-border rounded-xl bg-card p-6 shadow-sm">
              <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {note.rawContent}
              </pre>
            </div>
          </main>

          {/* Mobile Thumb Dock (Hidden on Desktop) */}
          <div className="lg:hidden fixed bottom-4 right-4 z-20 flex flex-col gap-2 items-end">
            <button className="size-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center">
              <Play className="size-5 fill-current ml-0.5" />
            </button>
          </div>
        </div>
      </div>
  );
}

export const UniversalNoteEditor: StoryObj = {
  name: 'Universal Note Editor (/notes/:noteId)',
  render: () => <UniversalNoteEditorView />,
};

// ── 2. Journal Date Stack ─────────────────────────────────────────────────────
export const JournalDateStack: StoryObj = {
  name: 'Journal Date Stack (/journal/:date)',
  render: () => {
    const { date, notes } = journalDateStackData;
    return (
      <div className="flex h-screen w-full bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Header */}
          <header className="px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10 flex items-center justify-between">
            <div>
              <div className="text-xs font-mono text-muted-foreground">JOURNAL STACK</div>
              <h1 className="text-xl font-bold">{date}</h1>
            </div>
            <div className="flex gap-2">
              {notes.map((n: { id: string; title: string }) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors font-medium"
                >
                  {n.title}
                </a>
              ))}
            </div>
          </header>

          {/* Stack of Notes */}
          <main className="max-w-3xl w-full mx-auto p-6 space-y-6">
            {notes.map((n) => (
              <div key={n.id} id={n.id} className="border border-border rounded-xl bg-card p-6 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <h2 className="text-base font-semibold">{n.title}</h2>
                  <div className="flex gap-1.5">
                    {(n.tags ?? []).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        #t
                      </span>
                    ))}
                  </div>
                </div>
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
                  {n.rawContent}
                </pre>
              </div>
            ))}
          </main>
        </div>
      </div>
    );
  },
};

// ── 3. Journal Stream ─────────────────────────────────────────────────────────
export const JournalStream: StoryObj = {
  name: 'Journal Stream (/journal)',
  render: () => {
    const { profile, entries } = journalStreamData;
    return (
      <div className="flex h-screen w-full bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Sticky Header with Query Bar */}
          <header className="px-6 py-3 border-b border-border bg-background/90 sticky top-0 z-10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-xl border border-border rounded-lg px-3 py-1.5 bg-muted/30">
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                notes
              </span>
              <span className="text-xs font-mono text-foreground flex-1">{profile.defaultWql}</span>
              <span className="text-[10px] text-muted-foreground font-mono">⌘/</span>
            </div>
          </header>

          {/* Stream Feed */}
          <main className="max-w-4xl w-full mx-auto p-6 space-y-4">
            {entries.map((e: { id: string; title: string; date: string; tags: string[]; excerpt: string[]; wodBlock: { content: string } }) => (
              <div key={e.id} className="border border-border rounded-xl bg-card p-5 hover:border-primary/40 transition-colors shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{e.date}</span>
                  <div className="flex gap-1">
                    {e.tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        #t
                      </span>
                    ))}
                  </div>
                </div>
                <h3 className="text-base font-bold text-foreground">{e.title}</h3>
                <p className="text-xs text-muted-foreground">{e.excerpt[0]}</p>
                <div className="bg-muted/40 rounded-lg p-3 font-mono text-xs text-foreground/90">
                  {e.wodBlock.content}
                </div>
              </div>
            ))}
          </main>
        </div>
      </div>
    );
  },
};

// ── 4. Collection Landing ─────────────────────────────────────────────────────
function CollectionLandingView() {
  const { collection, workouts } = collectionLandingData;
  const [selected, setSelected] = useState(workouts[0]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans">
      <div className="flex-1 flex flex-col min-w-0">
          <header className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
            <div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{collection.category}</div>
              <h1 className="text-xl font-bold">{collection.name}</h1>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
              <Play className="size-3.5 fill-current" /> Start Collection
            </button>
          </header>

          {/* Split Pane (Desktop Layout) */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            {/* Left Prose & List Panel */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 border-r border-border">
              <p className="text-sm text-muted-foreground leading-relaxed">{collection.description}</p>
              <div className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Included Workouts</h2>
                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                  {workouts.map((w: { id: string; name: string; content: string }) => (
                    <button
                      key={w.id}
                      onClick={() => setSelected(w)}
                      className={`w-full flex items-center justify-between p-3.5 text-left text-sm transition-colors ${selected.id === w.id ? 'bg-muted font-bold text-primary' : 'hover:bg-muted/50'}`}
                    >
                      <span>{w.name}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Interactive Code Panel */}
            <div className="w-full lg:w-[420px] bg-muted/20 p-6 flex flex-col gap-4 overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{selected.name}</h3>
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Whiteboard Script</span>
              </div>
              <div className="flex-1 border border-border rounded-xl bg-card p-4 font-mono text-xs text-foreground/90 whitespace-pre-wrap">
                {selected.content}
              </div>
              <button className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity">
                Run {selected.name}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}

export const CollectionLanding: StoryObj = {
  name: 'Collection Landing (/c/:slug)',
  render: () => <CollectionLandingView />,
};

// ── 5. Effort Detail ──────────────────────────────────────────────────────────
export const EffortDetail: StoryObj = {
  name: 'Effort Detail (/e/:slug)',
  render: () => {
    const { effort, recentSessions } = effortDetailData;
    return (
      <div className="flex h-screen w-full bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <header className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">{effort.label}</h1>
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                {effort.baseAttributes.discipline}
              </span>
              <span className="text-xs font-mono text-muted-foreground">MET {effort.baseAttributes.met}</span>
            </div>
            <button className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium">
              Edit Properties
            </button>
          </header>

          <main className="max-w-4xl w-full mx-auto p-6 space-y-6">
            {/* Movement Metadata Card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl border border-border bg-card">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Discipline</div>
                <div className="text-sm font-semibold capitalize">{effort.baseAttributes.discipline}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Factor</div>
                <div className="text-sm font-semibold">{effort.baseAttributes.disciplineFactor}x</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Intensity</div>
                <div className="text-sm font-semibold capitalize">{effort.baseAttributes.intensityTier}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Source</div>
                <div className="text-sm font-semibold capitalize">{effort.registrySource}</div>
              </div>
            </div>

            {/* Description Body */}
            <div className="border border-border rounded-xl bg-card p-6">
              <pre className="font-sans text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {effort.body}
              </pre>
            </div>

            {/* Recent Sessions */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Recent Executions</h2>
              <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
                {recentSessions.map((s: { sessionId: string; date: string; topLoad: string; volume: string }) => (
                  <div key={s.sessionId} className="flex items-center justify-between p-3.5 text-xs">
                    <span className="font-mono text-muted-foreground">{s.date}</span>
                    <span className="font-bold">Top Load: {s.topLoad}</span>
                    <span className="text-muted-foreground">Volume: {s.volume}</span>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  },
};

// ── 6. Session Execution Detail ───────────────────────────────────────────────
export const SessionExecutionDetail: StoryObj = {
  name: 'Session Execution Detail (/sessions/:sessionId)',
  render: () => {
    const { workoutTitle, metrics, statements } = sessionDetailData;
    return (
      <div className="flex h-screen w-full bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <header className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
            <div>
              <div className="text-xs font-mono text-muted-foreground">SESSION OUTCOME</div>
              <h1 className="text-xl font-bold">{workoutTitle}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                Completed
              </span>
              <span className="text-sm font-mono font-bold">{metrics.elapsedTime}</span>
            </div>
          </header>

          <main className="max-w-4xl w-full mx-auto p-6 space-y-6">
            {/* Split Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-border bg-card">
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Mile 1 Run</div>
                <div className="text-lg font-bold">{metrics.mileOne}</div>
              </div>
              <div className="p-4 rounded-xl border border-border bg-card">
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Calisthenics</div>
                <div className="text-lg font-bold">{metrics.calisthenics}</div>
              </div>
              <div className="p-4 rounded-xl border border-border bg-card">
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Mile 2 Run</div>
                <div className="text-lg font-bold">{metrics.mileTwo}</div>
              </div>
              <div className="p-4 rounded-xl border border-border bg-card">
                <div className="text-[10px] text-muted-foreground uppercase font-mono">Work Output</div>
                <div className="text-lg font-bold">{metrics.workOutput}</div>
              </div>
            </div>

            {/* Reconstructed Event Stream */}
            <div className="border border-border rounded-xl bg-card p-4 space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Statement Stream</h2>
              <div className="space-y-2">
                {statements.map((st: { outputType: string; timestamp: number; text: string }, i: number) => (
                  <div key={i} className="flex items-start gap-3 text-xs font-mono">
                    <span className="text-muted-foreground/60 w-16 shrink-0">+{i * 7}m</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${st.outputType === 'completion' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {st.outputType}
                    </span>
                    <span className="text-foreground">{st.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  },
};

// ── 7. Dashboard View ─────────────────────────────────────────────────────────
export const DashboardView: StoryObj = {
  name: 'Dashboard View (/d/:slug)',
  render: () => {
    const { dashboard, widgets } = dashboardViewData;
    return (
      <div className="flex h-screen w-full bg-background text-foreground font-sans">
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <header className="px-6 py-4 border-b border-border bg-background flex items-center justify-between">
            <div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">DASHBOARD</div>
              <h1 className="text-xl font-bold">{dashboard.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono bg-muted px-2 py-1 rounded">Range: {dashboard.weeks}w</span>
              <button className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                + Add Widget
              </button>
            </div>
          </header>

          <main className="max-w-5xl w-full mx-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {widgets.map((w: { id: string; title: string; wql: string; chartType: string; data: { label: string; value: number }[] }) => (
              <div key={w.id} className="border border-border rounded-xl bg-card p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">{w.title}</h3>
                  <span className="text-[10px] font-mono text-muted-foreground">{w.chartType}</span>
                </div>
                <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 p-2 rounded">
                  {w.wql}
                </div>
                <div className="h-40 flex items-end gap-2 pt-4 px-2 border-b border-border/40">
                  {w.data.slice(0, 8).map((d) => (
                    <div key={d.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <div
                        className="w-full bg-primary/70 hover:bg-primary transition-colors rounded-t"
                        style={{ height: `${Math.min(100, Math.max(15, (d.value / 36000) * 100))}%` }}
                      />
                      <span className="text-[9px] font-mono text-muted-foreground">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </main>
        </div>
      </div>
    );
  },
};

// ── 8. Wall Clock Runtime Tracker ─────────────────────────────────────────────
export const WallClockRuntime: StoryObj = {
  name: 'Wall Clock Runtime (/run/:runtimeId)',
  render: () => {
    const { workoutTitle, currentInterval, upcoming } = wallClockData;
    return (
      <div className="h-screen w-full bg-zinc-950 text-zinc-50 font-sans flex flex-col justify-between p-6 sm:p-10 select-none">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-400">ROUND {currentInterval.round} OF {currentInterval.totalRounds}</div>
            <h1 className="text-2xl font-bold tracking-tight">{workoutTitle}</h1>
          </div>
          <button className="text-xs font-mono px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white">
            ABORT
          </button>
        </div>

        {/* Center Giant HUD */}
        <div className="flex flex-col items-center justify-center text-center space-y-4 my-auto">
          <div className="text-8xl sm:text-9xl font-black font-mono tracking-tighter text-emerald-400">
            {currentInterval.timerDisplay}
          </div>
          <div className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            {currentInterval.movement}
          </div>
          <div className="text-lg font-mono text-zinc-400 bg-zinc-900/80 px-4 py-1.5 rounded-full border border-zinc-800">
            {currentInterval.target}
          </div>
        </div>

        {/* Bottom Advance Control */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-zinc-900">
          <div className="text-xs font-mono text-zinc-500">
            UP NEXT: <span className="text-zinc-300 font-semibold">{upcoming.nextMovement}</span> ({upcoming.nextTarget})
          </div>
          <button className="w-full sm:w-auto px-10 py-4 rounded-xl bg-emerald-500 text-zinc-950 font-black text-lg tracking-wide hover:bg-emerald-400 active:scale-95 transition-all shadow-lg shadow-emerald-500/20">
            ADVANCE ROUND
          </button>
        </div>
      </div>
    );
  },
};
