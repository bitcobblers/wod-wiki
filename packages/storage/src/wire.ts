/**
 * Wire DTOs + key helpers shared by the storage client (ApiStorage) and the
 * API server. Keys are scalars or scalar tuples (keyPath order); ranges bound
 * them. Over HTTP, keys/ranges travel as urlencoded JSON query params.
 *
 * Range-typed helpers accept real IDBKeyRange instances AND plain RangeDTO
 * literals — non-IDB runtimes (Bun, node, tests) have no IDBKeyRange global,
 * so everything duck-types on field shape.
 */

import type { StoreName } from './contract';
import type { StoreDef } from './schema';

export type Scalar = string | number;

/** Primary key: scalar for single-property keyPaths, tuple for compound. */
export type KeyDTO = Scalar | Scalar[];

export interface RangeDTO {
  only?: KeyDTO;
  /** Inclusive lower bound unless lowerOpen. Scalar or tuple (keyPath order). */
  lower?: KeyDTO;
  /** Inclusive upper bound unless upperOpen. Scalar or tuple (keyPath order). */
  upper?: KeyDTO;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

export type TxOp =
  | { op: 'put'; store: StoreName; value: unknown }
  | { op: 'delete'; store: StoreName; key: KeyDTO }
  | { op: 'clear'; store: StoreName };

/** Anything shaped like a range: real IDBKeyRange or a plain RangeDTO literal. */
export function isRange(arg: unknown): arg is RangeDTO {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) &&
    ('only' in arg || 'lower' in arg || 'upper' in arg || 'lowerOpen' in arg || 'upperOpen' in arg);
}

/** Reads one dotted property path ('a.b.c') off a row. */
export function extractKeyPart(value: unknown, dottedPath: string): Scalar | undefined {
  let cur: unknown = value;
  for (const part of dottedPath.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    // Dynamic key on an untyped row: index-signature view is the only way to read it.
    const row = cur as Record<string, unknown>;
    if (!(part in row)) return undefined;
    cur = row[part];
  }
  if (cur === null || typeof cur === 'object' || cur === undefined) return undefined;
  return cur as Scalar; // string/number/boolean leaf narrowed to the wire subset
}

/** Extracts a row's primary key per the store's inline keyPath. */
export function keyFromValue(def: StoreDef, value: unknown): KeyDTO {
  const parts = def.keyPath.map((p) => extractKeyPart(value, p));
  for (const [i, part] of parts.entries()) {
    if (part === undefined) {
      throw new Error(`keyFromValue(${def.name}): keyPath part '${def.keyPath[i]}' missing on value`);
    }
  }
  // Loop above proved every element defined.
  const key = parts as Scalar[];
  return key.length === 1 ? key[0] : key;
}

/** Canonical url-safe string form of a key (also the buffer/tx match key). */
export function encodeKey(key: KeyDTO): string {
  return encodeURIComponent(JSON.stringify(key));
}

/**
 * Converts an IndexedDB query — bare key, IDBKeyRange, or an already-wire
 * RangeDTO — to its wire form. Duck-types: objects with lower/upper/
 * lowerOpen/upperOpen fields (real ranges or plain literals) pass through;
 * scalars and tuple arrays become {only}.
 */
export function rangeFromIDB(query?: IDBValidKey | IDBKeyRange | RangeDTO): RangeDTO | undefined {
  if (query === undefined) return undefined;
  if (!isRange(query)) {
    // Bare IDBValidKey (scalar/tuple; exotic keys like Date pass through lossy).
    const key = query as KeyDTO;
    return { only: key };
  }
  if (query.only !== undefined) return query;
  const wire: RangeDTO = {};
  if (query.lower !== undefined && query.lower !== null) {
    wire.lower = query.lower;
    wire.lowerOpen = query.lowerOpen === true;
  }
  if (query.upper !== undefined && query.upper !== null) {
    // IDB upper bound idiom [prefix, []] uses [] > strings; normalize [] to \uffff on wire.
    wire.upper = Array.isArray(query.upper)
      ? (query.upper.map((p) => (Array.isArray(p) && p.length === 0 ? '\uffff' : p)) as KeyDTO)
      : query.upper;
    wire.upperOpen = query.upperOpen === true;
  }
  return wire.lower !== undefined || wire.upper !== undefined ? wire : undefined;
}

/** IndexedDB key ordering: numbers < strings < tuples; tuples lexicographic. */
export function compareKeys(a: KeyDTO, b: KeyDTO): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Array.isArray(a) ? 1 : -1;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareKeys(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'number' || typeof b === 'number') return typeof a === 'number' ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** True when a key matches a wire range (IDB bound semantics). */
export function keyInRange(key: KeyDTO, range: RangeDTO): boolean {
  if (range.only !== undefined) return compareKeys(key, range.only) === 0;
  if (range.lower !== undefined) {
    const c = compareKeys(key, range.lower);
    if (c < 0 || (c === 0 && range.lowerOpen === true)) return false;
  }
  if (range.upper !== undefined) {
    const c = compareKeys(key, range.upper);
    if (c > 0 || (c === 0 && range.upperOpen === true)) return false;
  }
  return true;
}
