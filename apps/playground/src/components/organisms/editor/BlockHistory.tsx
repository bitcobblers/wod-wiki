import { useEffect, useState } from 'react';
import { notePersistence, type INotePersistence } from '@/services/persistence';
import { formatDateTimeMedium } from '@/lib/dateFormat';
import type { BlockRevision, NoteBlock } from '@/types/storage';
import type { EditorIdentitySnapshot } from './NoteEditor';

export function revertBlock(snapshot: EditorIdentitySnapshot, revision: BlockRevision): EditorIdentitySnapshot {
  const current = snapshot.blocks[revision.blockId];
  const prefix = current ? '' : snapshot.rawContent.endsWith('\n') ? '\n' : '\n\n';
  const from = current?.from ?? snapshot.rawContent.length;
  const to = current?.to ?? from;
  const insert = prefix + revision.rawContent;
  const delta = insert.length - (to - from);
  const blocks: Record<string, NoteBlock> = {};
  for (const [id, block] of Object.entries(snapshot.blocks)) {
    if (id === revision.blockId) continue;
    blocks[id] = block.from >= to ? { ...block, from: block.from + delta, to: block.to + delta } : block;
  }
  blocks[revision.blockId] = {
    id: revision.blockId,
    kind: revision.kind,
    version: current?.version ?? revision.version,
    sourceRevision: snapshot.sourceRevision,
    from: from + prefix.length,
    to: from + insert.length,
    ...(revision.dialect ? { dialect: revision.dialect } : {}),
    ...(revision.sport ? { sport: revision.sport } : {}),
  };
  return { ...snapshot, rawContent: snapshot.rawContent.slice(0, from) + insert + snapshot.rawContent.slice(to), blocks };
}

export interface BlockHistoryProps {
  noteId: string;
  sourceRevision?: number;
  blocks?: Record<string, NoteBlock>;
  persistence?: INotePersistence;
  onRevert?: (revision: BlockRevision) => Promise<void>;
}

export function BlockHistory({ noteId, sourceRevision, blocks = {}, persistence = notePersistence, onRevert }: BlockHistoryProps) {
  const [rows, setRows] = useState<BlockRevision[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [leftVersion, setLeftVersion] = useState(0);
  const [rightVersion, setRightVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    persistence.getNoteBlockHistory(noteId).then(history => {
      if (cancelled) return;
      setRows(history.toSorted((a, b) => a.savedAt - b.savedAt || a.version - b.version));
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [noteId, sourceRevision, persistence]);
  const ids = Array.from(new Set(rows.map(row => row.blockId)));
  const blockId = ids.includes(selectedId) ? selectedId : ids[0] ?? '';
  const versions = rows.filter(row => row.blockId === blockId).toSorted((a, b) => a.version - b.version);
  const left = versions.find(row => row.version === leftVersion) ?? versions[0];
  const right = versions.find(row => row.version === rightVersion) ?? versions.at(-1);
  const revert = async () => {
    if (!left || !onRevert) return;
    setBusy(true);
    setError(null);
    try {
      await onRevert(left);
      setRows(await persistence.getNoteBlockHistory(noteId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer font-medium focus-visible:ring-2">Saved block history</summary>
    <div className="mt-3 space-y-3">
      {error && <p role="alert">{error}</p>}
      {ids.length === 0 ? <p className="text-sm text-muted-foreground">No saved actionable blocks.</p> : <>
        <label className="block text-sm">Block occurrence
          <select className="mt-1 block max-w-full rounded border bg-background p-2 text-foreground focus-visible:ring-2" value={blockId} onChange={event => { setSelectedId(event.target.value); setLeftVersion(0); setRightVersion(0); }}>
            {ids.map((id, index) => <option key={id} value={id}>Block {index + 1} · {id}{blocks[id] ? '' : ' · removed'}</option>)}
          </select>
        </label>
        <ol aria-label="Saved versions" className="space-y-1 text-sm" style={{ contentVisibility: 'auto' }}>
          {versions.map(row => <li key={row.version}>v{row.version} · <time dateTime={new Date(row.savedAt).toISOString()}>{formatDateTimeMedium(new Date(row.savedAt))}</time> · {row.kind}{row.dialect ? ` · ${row.dialect}` : ''}{row.sport ? ` · ${row.sport}` : ''}</li>)}
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          {[{ label: 'Compare saved version', row: left, set: setLeftVersion }, { label: 'With saved version', row: right, set: setRightVersion }].map(({ label, row, set }) => <div key={label} className="min-w-0">
            <label className="block text-sm">{label}<select className="ml-2 rounded border bg-background p-1 text-foreground focus-visible:ring-2" value={row?.version ?? 0} onChange={event => set(Number(event.target.value))}>{versions.map(version => <option key={version.version} value={version.version}>v{version.version}</option>)}</select></label>
            <pre aria-label={`${label} source`} className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{row?.rawContent}</pre>
          </div>)}
        </div>
        <p role="status" aria-live="polite" className="text-sm">{left?.rawContent === right?.rawContent && left?.kind === right?.kind && left?.dialect === right?.dialect && left?.sport === right?.sport ? 'Saved states are identical.' : 'Saved states differ.'}</p>
        {onRevert && left && <button type="button" disabled={busy} className="rounded border px-3 py-2 hover:bg-accent focus-visible:ring-2 disabled:opacity-50" onClick={() => void revert()}>{busy ? 'Saving…' : `Restore v${left.version} as a new saved version`}</button>}
      </>}
    </div>
  </details>;
}
