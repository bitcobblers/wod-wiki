/**
 * FeedTree — universal path-addressed byte tree port and runtime-agnostic adapters.
 *
 * Unifies:
 *   - MemoryFeedTree: in-memory tests, server snapshot staging, dirty diffs
 *   - HttpFeedTree: read-only fetch over GitHub Pages, custom peer URLs, and `wod server /feed/`
 *   - DirectoryHandleFeedTree: browser File System Access folder export/import
 */

export type FeedPath = string;

export type FeedTreeErrorCode =
  | 'not-found'
  | 'unsupported'
  | 'read-only'
  | 'checksum'
  | 'layout'
  | 'permission';

export class FeedTreeError extends Error {
  constructor(
    readonly code: FeedTreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FeedTreeError';
  }
}

export interface FeedFileStat {
  bytes: number;
  sha256?: string;
}

export interface FeedTreeReader {
  read(path: FeedPath): Promise<Uint8Array>;
  stat(path: FeedPath): Promise<FeedFileStat | undefined>;
  list?(prefix?: string): Promise<FeedPath[]>;
}

export interface FeedTreeWriter {
  write(path: FeedPath, bytes: Uint8Array): Promise<void>;
  delete(path: FeedPath): Promise<void>;
}

export interface FeedTree extends FeedTreeReader, FeedTreeWriter {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function normalizeFeedTreePath(rawPath: string): FeedPath {
  if (!rawPath || rawPath.includes('\0') || rawPath.includes('\\')) {
    throw new FeedTreeError('layout', `Invalid feed path '${rawPath}'`);
  }
  const trimmed = rawPath.replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    throw new FeedTreeError('layout', 'Feed path must not be empty');
  }
  const parts = trimmed.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new FeedTreeError('layout', `Disallowed path segment in '${rawPath}'`);
    }
  }
  return parts.join('/');
}

export async function sha256HexAsync(input: Uint8Array | string): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MemoryFeedTree implements FeedTree {
  private readonly store = new Map<FeedPath, Uint8Array>();

  constructor(initial?: Readonly<Record<string, string | Uint8Array>>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        const p = normalizeFeedTreePath(k);
        this.store.set(p, typeof v === 'string' ? encodeUtf8(v) : new Uint8Array(v));
      }
    }
  }

  async read(path: FeedPath): Promise<Uint8Array> {
    const p = normalizeFeedTreePath(path);
    const bytes = this.store.get(p);
    if (!bytes) throw new FeedTreeError('not-found', `Missing feed entry: ${p}`);
    return new Uint8Array(bytes);
  }

  async readText(path: FeedPath): Promise<string> {
    return decodeUtf8(await this.read(path));
  }

  async stat(path: FeedPath): Promise<FeedFileStat | undefined> {
    const p = normalizeFeedTreePath(path);
    const bytes = this.store.get(p);
    if (!bytes) return undefined;
    return {
      bytes: bytes.byteLength,
      sha256: await sha256HexAsync(bytes),
    };
  }

  async write(path: FeedPath, bytes: Uint8Array): Promise<void> {
    const p = normalizeFeedTreePath(path);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.store.set(p, copy);
  }

  async writeText(path: FeedPath, text: string): Promise<void> {
    await this.write(path, encodeUtf8(text));
  }

  async delete(path: FeedPath): Promise<void> {
    const p = normalizeFeedTreePath(path);
    this.store.delete(p);
  }

  async list(prefix = ''): Promise<FeedPath[]> {
    const clean = prefix ? normalizeFeedTreePath(prefix) + '/' : '';
    return [...this.store.keys()]
      .filter((k) => !clean || k.startsWith(clean) || k === clean.slice(0, -1))
      .sort();
  }

  entries(): Array<[FeedPath, Uint8Array]> {
    return [...this.store.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class HttpFeedTree implements FeedTreeReader {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl?: FetchLike) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async read(path: FeedPath): Promise<Uint8Array> {
    const clean = normalizeFeedTreePath(path);
    const isMutableIndex = clean === 'manifest.json' || clean.endsWith('/manifest.json');
    const doFetch = this.fetchImpl;
    const res = await doFetch(`${this.baseUrl}${clean}`, {
      cache: isMutableIndex ? 'no-cache' : 'default',
    });
    if (res.status === 404) {
      throw new FeedTreeError('not-found', `HTTP 404 for ${this.baseUrl}${clean}`);
    }
    if (!res.ok) {
      throw new FeedTreeError('permission', `HTTP ${res.status} fetching ${this.baseUrl}${clean}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async readJson<T = unknown>(path: FeedPath): Promise<T> {
    const text = decodeUtf8(await this.read(path));
    return JSON.parse(text) as T;
  }

  async stat(path: FeedPath): Promise<FeedFileStat | undefined> {
    try {
      const bytes = await this.read(path);
      return { bytes: bytes.byteLength, sha256: await sha256HexAsync(bytes) };
    } catch (err) {
      if (err instanceof FeedTreeError && err.code === 'not-found') return undefined;
      throw err;
    }
  }
}

/** Structural subset of the Web File System Access API so non-DOM builds need no ambient DOM types. */
export interface FileSystemWritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemFileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }>;
  createWritable(): Promise<FileSystemWritableLike>;
}

export interface FileSystemDirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export class DirectoryHandleFeedTree implements FeedTree {
  constructor(private readonly root: FileSystemDirectoryHandleLike) {}

  private async resolveDir(segments: string[], create: boolean): Promise<FileSystemDirectoryHandleLike> {
    let dir = this.root;
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create });
    }
    return dir;
  }

  async read(path: FeedPath): Promise<Uint8Array> {
    const clean = normalizeFeedTreePath(path);
    const parts = clean.split('/');
    const fileName = parts.pop()!;
    try {
      const dir = await this.resolveDir(parts, false);
      const handle = await dir.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new FeedTreeError('not-found', `Missing file '${clean}' in directory handle`);
    }
  }

  async stat(path: FeedPath): Promise<FeedFileStat | undefined> {
    try {
      const bytes = await this.read(path);
      return { bytes: bytes.byteLength, sha256: await sha256HexAsync(bytes) };
    } catch (err) {
      if (err instanceof FeedTreeError && err.code === 'not-found') return undefined;
      throw err;
    }
  }

  async write(path: FeedPath, bytes: Uint8Array): Promise<void> {
    const clean = normalizeFeedTreePath(path);
    const parts = clean.split('/');
    const fileName = parts.pop()!;
    try {
      const dir = await this.resolveDir(parts, true);
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      throw new FeedTreeError(
        'permission',
        `Could not write '${clean}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async delete(path: FeedPath): Promise<void> {
    const clean = normalizeFeedTreePath(path);
    const parts = clean.split('/');
    const fileName = parts.pop()!;
    try {
      const dir = await this.resolveDir(parts, false);
      await dir.removeEntry(fileName);
    } catch {
      // Deleting an already-absent file is idempotent.
    }
  }
}
