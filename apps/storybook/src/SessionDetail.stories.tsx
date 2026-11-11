/**
 * Playground / Views / Session Detail & Diagnostics
 *
 * Session detail surfaces over isolated, deterministic states:
 * 1. `CompletedHeroSession` — the version-pinned Murph fixture
 *    (`screens/data/session-detail.ts`) rendered as a session summary plus
 *    `OutputStatementsTable` / event stream, with a filter-interaction
 *    `play()` asserting segment & completion statements.
 * 2. `ActiveInProgressSession` — `activeSession` preset: `Fran (Live Session)`
 *    with an in-progress split and no completion statement yet.
 * 3. `SessionWithSkippedDependencyDiagnostic` — `skippedDependencyDiagnostic`
 *    preset: compiler-emitted `Skipped-Dependency Diagnostic` rows surfaced
 *    from the stored EventRecord metrics.
 */
import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  DEFAULT_OUTPUT_FILTERS,
  OutputFilterPills,
  OutputStatementsTable,
  normalizeOutputFilter,
} from '@bitcobblers/wod-wiki-ui';
import type { EventRecord, Session } from '@bitcobblers/wod-wiki-core';
import { notePersistence } from '@/services/persistence';
import { storageService } from '@/services/storage';
import { useDatabase } from './database/DatabaseContext';
import { storyActions } from './testing/storyActions';
import sessionDetailFixture from './screens/data/session-detail';

/** ms → h:mm:ss, or mm:ss under an hour (mirrors SessionExplorerPage). */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Compiler-emitted skipped-work diagnostics from stored EventRecord metrics. */
function diagnosticTexts(events: readonly EventRecord[]): string[] {
  return events.flatMap((event) =>
    event.metrics
      .filter((metric) => metric.type === 'diagnostic')
      .map((metric) => (typeof metric.value === 'string' ? metric.value : String(metric.value ?? ''))),
  );
}

function SessionDetailCard({ title, session, events }: {
  title: string;
  session: Session;
  events: readonly EventRecord[];
}) {
  const [filter, setFilter] = useState('');
  const diagnostics = diagnosticTexts(events);

  return (
    <div className="max-w-5xl space-y-3" data-testid="session-detail-card">
      <header className="rounded border border-border bg-card p-3">
        <h3 className="text-base font-semibold text-foreground" data-testid="session-detail-title">{title}</h3>
        <p className="font-mono text-[10px] text-muted-foreground">{session.id}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="session-detail-duration">Duration: <span className="font-mono text-foreground">{formatDuration(session.duration)}</span></span>
          <span data-testid="session-detail-status">
            Status: <span className={session.completed ? 'text-primary' : 'text-destructive'}>{session.completed ? 'completed' : session.status ?? 'stopped'}</span>
          </span>
          {session.repsCompleted !== undefined && (
            <span>Reps: <span className="font-mono text-foreground">{session.repsCompleted}</span></span>
          )}
        </div>
      </header>

      {diagnostics.length > 0 && (
        <section
          className="rounded border border-amber-500/40 bg-amber-500/10 p-3"
          data-testid="skipped-dependency-diagnostics"
        >
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
            Skipped-Dependency Diagnostic
          </h4>
          <ul className="mt-1 space-y-1">
            {diagnostics.map((text) => (
              <li
                key={text}
                data-testid="skipped-dependency-diagnostic-row"
                className="text-xs text-foreground"
              >
                {text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <OutputFilterPills
        presets={DEFAULT_OUTPUT_FILTERS.map(normalizeOutputFilter)}
        filter={filter}
        onChange={setFilter}
      />
      <OutputStatementsTable
        outputs={events}
        filter={filter}
        timeOrigin={session.startTime}
        onClearFilter={() => setFilter('')}
      />

      <ul className="rounded border border-border bg-card" data-testid="session-event-stream">
        {events.map((event) => (
          <li
            key={event.id}
            data-testid="session-event-row"
            className="flex flex-wrap items-baseline gap-x-2 border-b border-border/50 px-3 py-1.5 text-xs last:border-b-0"
          >
            <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{event.outputType}</span>
            {event.text && <span className="text-foreground">{event.text}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Murph fixture — pure component render, no storage plane involved. */
function CompletedHeroSessionView() {
  const { session, note, statements } = sessionDetailFixture;
  return <SessionDetailCard title={note.title} session={session} events={statements} />;
}

/** Reads one stored Session (hydrated via `parameters.domainState`) and its EventRecords. */
function StoredSessionDetail({ sessionId }: { sessionId: string }) {
  const { dataVersion } = useDatabase();
  const [view, setView] = useState<{ title: string; session: Session; events: EventRecord[] } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const sessions = await storageService.getRecentSessions();
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;
      const [events, note] = await Promise.all([
        storageService.getEventsByResult(session.id),
        notePersistence.getNote(session.noteId, { projection: 'summary' }).catch(() => undefined),
      ]);
      if (active) setView({ title: note?.title ?? session.noteId, session, events });
    })();
    return () => { active = false; };
  }, [dataVersion, sessionId]);

  if (!view) {
    return (
      <p data-testid="session-detail-loading" className="p-4 text-xs text-muted-foreground">
        Loading session…
      </p>
    );
  }
  return <SessionDetailCard title={view.title} session={view.session} events={view.events} />;
}

const meta: Meta<typeof SessionDetailCard> = {
  title: 'Playground/Views/Session Detail & Diagnostics',
  component: SessionDetailCard,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof SessionDetailCard>;

export const CompletedHeroSession: Story = {
  parameters: { layout: 'padded', database: false },
  render: () => <CompletedHeroSessionView />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('session-detail-title')).toHaveTextContent('Murph (Hero WOD)');
    await expect(canvas.getByTestId('session-detail-duration')).toHaveTextContent('43:00');
    await expect(canvas.getByTestId('session-detail-status')).toHaveTextContent('completed');

    const table = canvas.getByTestId('output-statements-table');
    await expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    await userEvent.click(canvas.getByTestId('output-filter-preset-segments'));
    await expect(table.querySelectorAll('tbody tr')).toHaveLength(3);

    const stream = canvas.getByTestId('session-event-stream');
    await expect(stream).toHaveTextContent('1.0 mi Run completed in 7:45');
    await expect(stream).toHaveTextContent('1.0 mi Run completed in 8:45');
    await expect(stream).toHaveTextContent('Workout finished. Total Time: 43:00');
  },
};

export const ActiveInProgressSession: Story = {
  parameters: { layout: 'padded', database: false, domainState: 'activeSession' },
  render: () => <StoredSessionDetail sessionId="sess-active-fran" />,
};

export const SessionWithSkippedDependencyDiagnostic: Story = {
  parameters: { layout: 'padded', database: false, domainState: 'skippedDependencyDiagnostic' },
  render: () => <StoredSessionDetail sessionId="sess-diagnostic-1" />,
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId('skipped-dependency-diagnostic-row');
    await expect(row).toBeVisible();
    await expect(row).toHaveTextContent('Skipped work: missing required input resistance');
    await expect(canvas.getByTestId('session-detail-title')).toHaveTextContent('Unloaded Deadlift Diagnostic');
  },
};
