/**
 * Transaction write-buffer + read-overlay helpers shared by the HTTP
 * ApiStorage and the SQL SqlStorage backends. A transaction buffers puts and
 * deletes; reads overlay the buffer on backend rows in op order, so
 * read-your-writes holds without round-tripping uncommitted data.
 */

import type { StoreName } from './contract';
import {
  compareKeys,
  extractKeyPart,
  keyFromValue,
  keyInRange,
  type KeyDTO,
  type RangeDTO,
  type TxOp,
} from './wire';
import type { StoreDef } from './schema';

export interface BufferedPut { kind: 'put'; value: unknown }
export interface BufferedDelete { kind: 'delete'; key: KeyDTO }
export type BufferEntry = BufferedPut | BufferedDelete;

// Buffer slot key: store + \u0000 + raw JSON of the key (JSON text never
// contains a literal \u0000, so the separator is unambiguous).
export const bufferSlot = (store: StoreName, key: KeyDTO): string => `${store}\u0000${JSON.stringify(key)}`;

/** True when this tx has buffered writes (puts, deletes or a clear) for the store. */
export function isDirty(store: StoreName, buffer?: Map<string, BufferEntry>, cleared?: Set<StoreName>): boolean {
  if (cleared?.has(store)) return true;
  if (!buffer) return false;
  const prefix = `${store}\u0000`;
  for (const slot of buffer.keys()) {
    if (slot.startsWith(prefix)) return true;
  }
  return false;
}

/** Point lookup against the buffer; undefined means consult the backend. */
export function bufferedGet<T>(store: StoreName, key: KeyDTO, buffer?: Map<string, BufferEntry>):
  | { hit: true; value: T }
  | { hit: false }
  | undefined {
  if (!buffer) return undefined;
  const entry = buffer.get(bufferSlot(store, key));
  if (!entry) return undefined;
  return entry.kind === 'put' ? { hit: true, value: entry.value as T } : { hit: false };
}

/**
 * Applies buffered puts and deletes before range filtering, ordering and
 * paging. Rows missing an index field are not in the index (IDB semantics);
 * multi-entry keys match when any entry is in range.
 */
export function overlayRows<T>(
  def: StoreDef,
  store: StoreName,
  buffer: Map<string, BufferEntry> | undefined,
  cleared: Set<StoreName> | undefined,
  rows: T[],
  count?: number,
  range?: RangeDTO,
  indexName?: string,
): T[] {
  if (!buffer || !isDirty(store, buffer, cleared)) return count !== undefined ? rows.slice(0, count) : rows;
  const out = new Map<string, T>();
  if (!cleared?.has(store)) {
    // Out-map keys are raw JSON key text — same form as buffer slot suffixes.
    for (const row of rows) out.set(JSON.stringify(keyFromValue(def, row)), row);
  }
  const prefix = `${store}\u0000`;
  for (const [slot, entry] of buffer) {
    if (!slot.startsWith(prefix)) continue;
    if (entry.kind === 'put') out.set(slot.slice(prefix.length), entry.value as T);
    else out.delete(slot.slice(prefix.length));
  }
  // Dirty reads fetch the complete candidate range: buffered deletes can
  // remove the remote head, and puts can change index membership or order.
  const index = indexName ? def.indexes.find(i => i.name === indexName) : undefined;
  if (indexName && !index) throw new Error(`unknown index '${indexName}' for ${store}`);
  const keyOf = (row: T): KeyDTO | undefined => {
    if (!index) return keyFromValue(def, row);
    const parts = index.keyPath.map(path => extractKeyPart(row, path));
    if (parts.some(part => part === undefined)) return undefined;
    const keys = parts.filter((part): part is string | number => part !== undefined);
    return keys.length === 1 ? keys[0] : keys;
  };
  const matches = (row: T): boolean => {
    if (index?.multiEntry) {
      let values: unknown = row;
      for (const part of index.keyPath[0].split('.')) {
        if (values === null || typeof values !== 'object' || !(part in values)) return false;
        values = Reflect.get(values, part);
      }
      return Array.isArray(values) && values.some(value =>
        (typeof value === 'string' || typeof value === 'number') && (!range || keyInRange(value, range)));
    }
    const key = keyOf(row);
    return key !== undefined && (!range || keyInRange(key, range));
  };
  const merged = [...out.values()].filter(matches);
  merged.sort((a, b) => {
    const primary = compareKeys(keyFromValue(def, a), keyFromValue(def, b));
    if (index?.multiEntry) return primary;
    const ak = keyOf(a), bk = keyOf(b);
    return ak !== undefined && bk !== undefined ? compareKeys(ak, bk) || primary : primary;
  });
  return count !== undefined ? merged.slice(0, count) : merged;
}

/** Drains the tx buffer into wire ops (clears first, then puts/deletes in op order). */
export function bufferToOps(storeNames: Iterable<StoreName>, buffer: Map<string, BufferEntry>, cleared: Set<StoreName>): TxOp[] {
  const known = new Set(storeNames);
  const ops: TxOp[] = [];
  for (const store of cleared) {
    if (known.has(store)) ops.push({ op: 'clear', store });
  }
  for (const [slot, entry] of buffer) {
    const sep = slot.indexOf('\u0000');
    const store = slot.slice(0, sep) as StoreName;
    if (!known.has(store)) continue;
    if (entry.kind === 'put') ops.push({ op: 'put', store, value: entry.value });
    else ops.push({ op: 'delete', store, key: JSON.parse(slot.slice(sep + 1)) as KeyDTO });
  }
  return ops;
}
