import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliMain } from '../src/index';
import { openCliDb } from '../src/cli/db';
import { createHandler } from '../src/server/app';

describe('MCP Server (/api/mcp) and CLI Noun-Verb Parity', () => {
  let tempDir: string;
  let dbFile: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `wod-mcp-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    dbFile = join(tempDir, 'test.db');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function postMcpJsonRpc(
    handler: (req: Request) => Promise<Response>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const req = new Request('http://127.0.0.1:3000/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const res = await handler(req);
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  }

  it('serves /api/mcp (initialize, tools/list, tools/call, resources/read, prompts/get) and /.well-known/agent-capabilities.json', async () => {
    const dbHandle = await openCliDb({ kind: 'sqlite', path: dbFile });
    try {
      const handler = createHandler(dbHandle.db, { playgroundDist: tempDir });

      // 1. Capabilities discovery endpoint
      const capRes = await handler(new Request('http://127.0.0.1:3000/.well-known/agent-capabilities.json'));
      expect(capRes.status).toBe(200);
      const manifest = (await capRes.json()) as { domainTools: Array<{ name: string }> };
      expect(manifest.domainTools).toHaveLength(22);

      // 2. MCP initialize
      const init = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'vitest-agent', version: '1.0.0' },
        },
      });
      expect(init.status).toBe(200);
      expect((init.json.result as { serverInfo: { name: string } }).serverInfo.name).toBe('wod-wiki');

      // 3. MCP tools/list
      const toolsList = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      expect(toolsList.status).toBe(200);
      const tools = (toolsList.json.result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(22);
      expect(tools.some((t) => t.name === 'wod_note_upsert')).toBe(true);

      // 4. MCP tools/call: create note -> run session -> query WQL
      const createCall = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'wod_note_upsert',
          arguments: {
            title: 'MCP Cindy',
            content: '# MCP Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```',
          },
        },
      });
      expect(createCall.status).toBe(200);
      const created = (createCall.json.result as { structuredContent: { noteId: string; blockCount: number } })
        .structuredContent;
      expect(created.noteId).toBeTruthy();
      expect(created.blockCount).toBe(1);

      // 5. MCP resources/read on dynamic note template URI
      const noteResource = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: {
          uri: `wod://note/${created.noteId}`,
        },
      });
      expect(noteResource.status).toBe(200);
      const contents = (noteResource.json.result as { contents: Array<{ text: string }> }).contents;
      expect(contents[0]?.text).toContain('MCP Cindy');

      // 6. MCP prompts/get
      const promptRes = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 5,
        method: 'prompts/get',
        params: {
          name: 'encode-workout',
          arguments: { workoutText: '21-15-9 thrusters and pull-ups' },
        },
      });
      expect(promptRes.status).toBe(200);
      const messages = (promptRes.json.result as { messages: Array<{ content: { text: string } }> }).messages;
      expect(messages[0]?.content.text).toContain('21-15-9 thrusters and pull-ups');
    } finally {
      await dbHandle.close();
    }
  });

  it('enforces mcpReadonly (Tier 0 only) and mcpToken Bearer auth on /api/mcp', async () => {
    const dbHandle = await openCliDb({ kind: 'sqlite', path: dbFile });
    try {
      const handler = createHandler(dbHandle.db, {
        playgroundDist: tempDir,
        mcpReadonly: true,
        mcpToken: 'secret-token-123',
      });

      // Missing token -> 401
      const unauth = await postMcpJsonRpc(handler, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      expect(unauth.status).toBe(401);

      // Valid token + readonly -> only Tier 0 tools exposed (mutating tools excluded)
      const authed = await postMcpJsonRpc(
        handler,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        },
        { authorization: 'Bearer secret-token-123' },
      );
      expect(authed.status).toBe(200);
      const tools = (authed.json.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'wod_query_wql')).toBe(true);
      expect(tools.some((t) => t.name === 'wod_note_upsert')).toBe(false);
      expect(tools.some((t) => t.name === 'wod_note_delete')).toBe(false);
    } finally {
      await dbHandle.close();
    }
  });

  it('executes CLI noun-verb commands with --json and returns exit code 4 when Tier 2 --yes is omitted', async () => {
    const runCli = async (args: string[]) => {
      let stdout = '';
      let stderr = '';
      const code = await cliMain([...args, '--db', dbFile], {
        stdout: (t) => {
          stdout += `${t}\n`;
        },
        stderr: (t) => {
          stderr += `${t}\n`;
        },
      });
      return { code, stdout: stdout.trim(), stderr: stderr.trim() };
    };

    // 1. Parse dry-run (--no-save) does not create DB
    let parseStdout = '';
    const parseCode = await cliMain(['parse', '-', '--no-save', '--json', '--db', dbFile], {
      stdout: (t) => {
        parseStdout += t;
      },
      readStdinFn: async () => '(21-15-9)\n  Thrusters @95lb\n  Pull-ups',
    });
    expect(parseCode).toBe(0);
    expect(JSON.parse(parseStdout).kind).toBe('parse-tree');
    expect(existsSync(dbFile)).toBe(false);

    // 2. Initialize DB and create a note via noun-verb CLI
    expect((await runCli(['init'])).code).toBe(0);

    const createRes = await runCli([
      'note',
      'create',
      '--title',
      'CLI Fran',
      '--markdown',
      '# CLI Fran\n\n```time\n(21-15-9)\n  Thrusters @95lb\n  Pull-ups\n```',
      '--json',
    ]);
    expect(createRes.code).toBe(0);
    const createdEnvelope = JSON.parse(createRes.stdout) as {
      ok: boolean;
      tool: string;
      data: { noteId: string };
    };
    expect(createdEnvelope.ok).toBe(true);
    expect(createdEnvelope.tool).toBe('wod_note_upsert');
    const noteId = createdEnvelope.data.noteId;

    // 3. Run headless session via `wod run --note <noteId> --json`
    const runSession = await runCli(['run', '--note', noteId, '--json']);
    expect(runSession.code).toBe(0);
    const runEnvelope = JSON.parse(runSession.stdout) as {
      ok: boolean;
      data: { sessionId: string; completed: boolean };
    };
    expect(runEnvelope.ok).toBe(true);
    expect(runEnvelope.data.completed).toBe(true);

    // 4. Tier 2 confirmation gate: deleting without --yes returns exit code 4
    const deleteBlocked = await runCli(['note', 'delete', noteId, '--json']);
    expect(deleteBlocked.code).toBe(4);
    const blockedJson = JSON.parse(deleteBlocked.stdout) as {
      ok: boolean;
      code: string;
      exitCode: number;
      targetId: string;
    };
    expect(blockedJson.ok).toBe(false);
    expect(blockedJson.code).toBe('CONFIRMATION_REQUIRED');
    expect(blockedJson.exitCode).toBe(4);
    expect(blockedJson.targetId).toBe(noteId);

    // 5. Deleting with matching --yes <noteId> succeeds with exit code 0
    const deleteConfirmed = await runCli(['note', 'delete', noteId, '--yes', noteId, '--json']);
    expect(deleteConfirmed.code).toBe(0);
    expect(JSON.parse(deleteConfirmed.stdout).data.deleted).toBe(true);

    // 6. wod doctor --json reports 22 domain tools and bundled skills
    const doctor = await runCli(['doctor', '--json']);
    expect(doctor.code).toBe(0);
    const doctorData = JSON.parse(doctor.stdout).data as {
      domainToolCount: number;
      bundledSkills: string[];
    };
    expect(doctorData.domainToolCount).toBe(22);
    expect(doctorData.bundledSkills).toEqual(
      expect.arrayContaining(['wod-extraction', 'wod-cli', 'wod-wql']),
    );
  });
});
