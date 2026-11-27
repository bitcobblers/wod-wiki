import { describe, expect, it } from 'vitest';
import { buildSafeExport } from './restoreService';

describe('buildSafeExport (WW-144)', () => {
  it('handles undefined op.value safely and losslessly encodes ArrayBuffer attachments', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const raw = buildSafeExport({
      exportedAt: '2026-11-26T20:00:00.000Z',
      contentSources: [{ key: 'wodwiki.seedSources', value: [] }],
      rows: [
        { store: 'notes', rows: [{ id: 'n-1', title: 'Test Note' }] },
        { store: 'attachments', rows: [{ id: 'a-1', data: bytes }] },
      ],
      pendingGroups: [
        {
          id: 'grp-1',
          at: 1700000000000,
          ops: [
            { op: 'put', store: 'notes', key: 'n-1', value: { id: 'n-1', title: 'Updated' } },
            { op: 'put', store: 'notes', key: 'n-2', value: undefined },
            { op: 'delete', store: 'notes', key: 'n-3' },
          ],
        },
      ],
    });

    // Compact JSON (no pretty-print indentation blowup on 260+ outbox groups)
    expect(raw.includes('\n  ')).toBe(false);

    const parsed = JSON.parse(raw) as {
      format: string;
      version: number;
      rows: Array<{ store: string; rows: Array<Record<string, unknown>> }>;
      pendingGroups: Array<{ id: string; ops: Array<Record<string, unknown>> }>;
    };
    expect(parsed.format).toBe('wod-wiki-safe-export');
    expect(parsed.version).toBe(1);
    expect(parsed.rows[0]?.rows[0]?.title).toBe('Test Note');
    // Binary attachment data is encoded losslessly as a tagged base64 object
    const attData = parsed.rows[1]?.rows[0]?.data as Record<string, unknown>;
    expect(attData).toBeTruthy();
    expect(typeof attData).toBe('object');
    expect(parsed.pendingGroups[0]?.ops).toHaveLength(3);
  });
});
