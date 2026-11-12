import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiStorage, type IStorage } from '@bitcobblers/wod-wiki-storage';
import { MemoryFeedTree, type FeedTree } from '@bitcobblers/wod-wiki-engine';
import type { CliDatabaseConfig } from './config';
import { openCliDb, type CliDb } from './db';
import { NodeFsFeedTree } from './nodeFeedTree';
import { createWodMcpServer } from '../mcp/createWodMcpServer';

export interface RunMcpStdioOptions {
  database?: CliDatabaseConfig;
  serverUrl?: string;
  readonly?: boolean;
  writeErr?: (text: string) => void;
}

/**
 * Starts the `wod mcp` stdio server using `@modelcontextprotocol/sdk`'s
 * `StdioServerTransport`. All diagnostic messages go to `stderr` so `stdout`
 * stays strictly reserved for JSON-RPC frames.
 */
export async function runMcpStdio(options: RunMcpStdioOptions): Promise<number> {
  const logErr = options.writeErr ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  let dbHandle: CliDb | undefined;
  let storage: IStorage;
  let feedTree: FeedTree;
  let baseUrl = '';

  if (options.serverUrl) {
    const trimmed = options.serverUrl.replace(/\/+$/, '');
    const apiBase = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    storage = new ApiStorage(apiBase);
    feedTree = new MemoryFeedTree();
    baseUrl = trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
  } else {
    if (!options.database) {
      logErr('[wod mcp] Error: Missing database configuration');
      return 1;
    }
    dbHandle = await openCliDb(options.database);
    storage = dbHandle.storage;
    feedTree =
      options.database.kind === 'sqlite'
        ? new NodeFsFeedTree(`${options.database.path}.feed`)
        : new MemoryFeedTree();
  }

  const server = createWodMcpServer({
    storage,
    feedTree,
    baseUrl,
    readonly: options.readonly,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return new Promise<number>((resolve) => {
    let closed = false;
    const finish = async (code: number) => {
      if (closed) return;
      closed = true;
      await server.close().catch(() => {});
      if (dbHandle) {
        await dbHandle.close().catch(() => {});
      }
      resolve(code);
    };

    transport.onclose = () => {
      void finish(0);
    };
    transport.onerror = (err) => {
      logErr(`[wod mcp] Transport error: ${err.message}`);
    };
    process.once('SIGINT', () => {
      void finish(0);
    });
    process.once('SIGTERM', () => {
      void finish(0);
    });
  });
}
