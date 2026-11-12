import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SqlStorage, type Database } from '@bitcobblers/wod-wiki-storage/sql';
import type { FeedTree } from '@bitcobblers/wod-wiki-engine';
import { createWodMcpServer } from './createWodMcpServer';

const MCP_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, MCP-Protocol-Version',
};

function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizeAcceptForPost(request: Request): Request {
  if (request.method !== 'POST') return request;
  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('application/json') && accept.includes('text/event-stream')) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set('accept', 'application/json, text/event-stream');
  return new Request(request, { headers });
}

export interface HandleMcpHttpOptions {
  db: Database;
  feedTree: FeedTree;
  baseUrl: string;
  readonly?: boolean;
  authToken?: string;
}

/**
 * Handles Web-Standard Streamable HTTP MCP requests at `/api/mcp`.
 * Uses stateless per-request `WebStandardStreamableHTTPServerTransport` with
 * `enableJsonResponse: true` so both official MCP SDK clients and plain HTTP
 * JSON-RPC clients work out of the box without sticky session requirements.
 */
export async function handleMcpHttpRequest(
  request: Request,
  options: HandleMcpHttpOptions,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  const expectedToken = options.authToken ?? process.env.WOD_MCP_TOKEN?.trim();
  if (expectedToken) {
    const authHeader = request.headers.get('authorization') ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (bearer !== expectedToken) {
      return withMcpCors(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized: missing or invalid Bearer token' },
            id: null,
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
  }

  const storage = new SqlStorage(options.db);
  const server = createWodMcpServer({
    storage,
    feedTree: options.feedTree,
    baseUrl: options.baseUrl,
    readonly: options.readonly ?? process.env.WOD_MCP_READONLY === '1',
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    const normalizedReq = normalizeAcceptForPost(request);
    const response = await transport.handleRequest(normalizedReq);
    return withMcpCors(response);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
