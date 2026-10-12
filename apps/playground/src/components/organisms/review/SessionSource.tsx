import { useEffect, useState } from 'react';
import { IndexedDBNotePersistence, notePersistence } from '@/services/persistence';
import type { BlockRevision, Session } from '@/types/storage';
import { BlockHistory } from '../editor/BlockHistory';

export function SessionSource({ sessionId }: { sessionId: string }) {
  const [source, setSource] = useState<{ session: Session; revision: BlockRevision } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    void (async () => {
      const session = await notePersistence.getSessionById?.(sessionId);
      if (!session) throw new Error('Session not found.');
      const revision = await notePersistence.getBlockRevision(session.noteId, session.blockId, session.blockVersion);
      if (!revision) throw new Error('The pinned saved workout is unavailable.');
      if (!cancelled) setSource({ session, revision });
    })().catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [sessionId]);
  return <section aria-label="Pinned workout source" className="space-y-3 border-b p-4">
    <h2 className="font-semibold">Saved workout used by this session</h2>
    {error && <p role="alert">{error}</p>}
    {source ? <>
      <p className="break-all text-sm">Block {source.session.blockId} · v{source.revision.version} · {source.revision.dialect}{source.revision.sport ? ` · ${source.revision.sport}` : ''}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{source.revision.rawContent}</pre>
      <button type="button" disabled={replaying} className="rounded border px-3 py-2 hover:bg-accent focus-visible:ring-2" onClick={async () => {
        setReplaying(true);
        setError(null);
        try {
          await new IndexedDBNotePersistence().rederiveResultAnalytics(sessionId);
          setStatus('Analytics replayed from the pinned saved workout. Reload the results to view them.');
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          setReplaying(false);
        }
      }}>{replaying ? 'Replaying…' : 'Replay saved analytics'}</button>
      <p role="status" aria-live="polite" className="text-sm">{status}</p>
      <BlockHistory noteId={source.session.noteId} />
    </> : !error ? <p role="status">Loading saved workout…</p> : null}
  </section>;
}
