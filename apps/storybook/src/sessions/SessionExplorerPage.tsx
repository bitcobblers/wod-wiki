/**
 * Session Explorer — lists sessions recorded in the ACTIVE database
 * (storageService.getRecentSessions). Selecting a session loads its event
 * rows (getEventsByResult) and its stored note. An empty database renders an
 * explicit empty state, never a blank page.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatDateTimeMediumShort } from '@/lib/dateFormat';
import type { EventRecord, Session } from '@bitcobblers/wod-wiki-core';
import { notePersistence } from '@/services/persistence';
import { storageService } from '@/services/storage';
import { useDatabase } from '../database/DatabaseContext';

const RECENT_LIMIT = 25;

/** ms → h:mm:ss, or mm:ss under an hour. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** One-line readout per event row — summary rows carry exactly one metric. */
function eventSummary(event: EventRecord): string {
  const metric = event.metrics[0];
  const parts = [event.outputType];
  if (metric) {
    if (metric.value != null) parts.push(String(metric.value));
    if (metric.unit) parts.push(metric.unit);
  } else if (event.text) {
    parts.push(event.text);
  }
  return parts.join(' · ');
}

interface SessionRow {
  session: Session;
  noteTitle: string;
}

export function SessionExplorerPage() {
  const { dataVersion } = useDatabase();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [noteTags, setNoteTags] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sessions = await storageService.getRecentSessions(RECENT_LIMIT);
      const withTitles = await Promise.all(sessions.map(async (session): Promise<SessionRow> => {
        const note = await notePersistence
          .getNote(session.noteId, { projection: 'summary' })
          .catch(() => undefined);
        return { session, noteTitle: note?.title ?? session.noteId };
      }));
      setRows(withTitles);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Re-read when the active database's content changes (a run was stored, the
  // seed import landed, or the user switched databases).
  useEffect(() => { void load(); }, [load, dataVersion]);

  const select = useCallback(async (session: Session) => {
    setSelectedId(session.id);
    setEvents(await storageService.getEventsByResult(session.id));
    const note = await notePersistence
      .getNote(session.noteId, { projection: 'summary' })
      .catch(() => undefined);
    setNoteTags(note ? (note.tags.join(', ') || 'no tags') : session.noteId);
  }, []);

  const selected = rows?.find((row) => row.session.id === selectedId) ?? null;

  return (
    <div className="max-w-3xl space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Session Explorer</h2>
        <p className="text-xs text-muted-foreground">
          The {RECENT_LIMIT} most recent sessions in the active database.
        </p>
      </div>

      {loadError && (
        <div
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="sessions-error"
          role="alert"
        >
          Failed to load sessions: {loadError}
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <div
          className="rounded border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground"
          data-testid="sessions-empty"
        >
          No sessions recorded in the active database yet — run a workout in the workbench first.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="overflow-hidden rounded border border-border bg-card" data-testid="sessions-list">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-3 py-2 font-medium">Start</th>
                <th className="px-3 py-2 font-medium">End</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ session, noteTitle: title }) => (
                <tr
                  key={session.id}
                  data-testid="session-row"
                  onClick={() => void select(session)}
                  className={`cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-muted/40 ${session.id === selectedId ? 'bg-muted/60' : ''}`}
                >
                  <td className={`px-3 py-2 ${session.id === selectedId ? 'text-primary' : 'text-foreground'}`}>{title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDateTimeMediumShort(new Date(session.startTime))}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDateTimeMediumShort(new Date(session.endTime))}</td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{formatDuration(session.duration)}</td>
                  <td className="px-3 py-2">
                    <span
                      data-testid="session-row-status"
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${session.completed ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}
                    >
                      {session.completed ? 'completed' : session.status ?? 'stopped'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="rounded border border-border bg-card p-3" data-testid="session-detail">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground" data-testid="session-detail-title">
              {selected.noteTitle}
            </h3>
            <span className="font-mono text-[10px] text-muted-foreground">{selected.session.id}</span>
          </div>
          <p className="mb-2 text-xs text-muted-foreground" data-testid="session-detail-note">
            Note tags: {noteTags ?? '…'}
          </p>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {events.length} event{events.length === 1 ? '' : 's'}
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="session-events-empty">
              No events recorded for this session.
            </p>
          ) : (
            <ul data-testid="session-events">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-2 border-b border-border/50 py-1 text-xs last:border-b-0"
                  data-testid="session-event-row"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatDateTimeMediumShort(new Date(event.timestamp))}
                  </span>
                  <span className="text-foreground">{eventSummary(event)}</span>
                  <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{event.grain}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
