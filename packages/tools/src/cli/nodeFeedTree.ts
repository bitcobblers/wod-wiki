import {
  FeedTreeError,
  normalizeFeedTreePath,
  sha256HexAsync,
  type FeedFileStat,
  type FeedPath,
  type FeedTree,
} from '@bitcobblers/wod-wiki-engine';
import { nodeFs, nodePath } from './db';

/**
 * Node/Bun filesystem adapter for `FeedTree`.
 * Uses lazy `nodeFs()`/`nodePath()` shims so browser bundles never pull `node:fs`.
 */
export class NodeFsFeedTree implements FeedTree {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = nodePath().resolve(rootDir);
  }

  get root(): string {
    return this.rootDir;
  }

  private absPath(relPath: FeedPath): string {
    const clean = normalizeFeedTreePath(relPath);
    const resolved = nodePath().resolve(this.rootDir, clean);
    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + '/') && !resolved.startsWith(this.rootDir + '\\')) {
      throw new FeedTreeError('layout', `Path '${relPath}' escapes root '${this.rootDir}'`);
    }
    return resolved;
  }

  async read(path: FeedPath): Promise<Uint8Array> {
    const abs = this.absPath(path);
    const fs = nodeFs() as unknown as {
      existsSync(p: string): boolean;
      readFileSync(p: string): Uint8Array;
    };
    if (!fs.existsSync(abs)) {
      throw new FeedTreeError('not-found', `File not found: ${path}`);
    }
    return new Uint8Array(fs.readFileSync(abs));
  }

  async stat(path: FeedPath): Promise<FeedFileStat | undefined> {
    try {
      const bytes = await this.read(path);
      return {
        bytes: bytes.byteLength,
        sha256: await sha256HexAsync(bytes),
      };
    } catch (err) {
      if (err instanceof FeedTreeError && err.code === 'not-found') return undefined;
      throw err;
    }
  }

  async write(path: FeedPath, bytes: Uint8Array): Promise<void> {
    const abs = this.absPath(path);
    const p = nodePath();
    const fs = nodeFs() as unknown as {
      mkdirSync(dir: string, opts: { recursive: boolean }): void;
      writeFileSync(file: string, data: Uint8Array): void;
    };
    fs.mkdirSync(p.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
  }

  async delete(path: FeedPath): Promise<void> {
    const abs = this.absPath(path);
    const fs = nodeFs();
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  }
}
