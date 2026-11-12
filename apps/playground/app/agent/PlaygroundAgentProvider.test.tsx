/**
 * WW-025: `installModelContextExecuteToolAdapter` normalizes the three
 * `modelContext.executeTool` call shapes agents actually use, so arguments
 * reach tool handlers instead of being defaulted to `{}` by the polyfill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { PlaygroundAgentProvider, installModelContextExecuteToolAdapter } from './PlaygroundAgentProvider';

interface FakeRegisteredTool {
  name: string;
  title: string;
  description: string;
  origin: string;
  window: unknown;
}

function makeRegisteredTool(name: string): FakeRegisteredTool {
  return {
    name,
    title: name,
    description: `${name} tool`,
    origin: 'http://localhost/',
    window: globalThis.window,
  };
}

interface FakeModelContext {
  __isBrowserMcpServer: boolean;
  registerTool: () => Promise<{ unregister(): void }>;
  getTools: () => Promise<FakeRegisteredTool[]>;
  executeTool: (...args: unknown[]) => Promise<string>;
}

function makeFakeModelContext(tools: FakeRegisteredTool[]) {
  const calls: Array<{ thisArg: unknown; args: unknown[] }> = [];
  const originalExecute = async function (this: unknown, ...args: unknown[]) {
    const [tool, input] = args as [FakeRegisteredTool, object | undefined];
    calls.push({ thisArg: this, args: [tool, input] });
    return JSON.stringify({ tool: tool.name, input: input ?? null });
  };
  const mc: FakeModelContext = {
    __isBrowserMcpServer: true,
    registerTool: async () => ({ unregister() {} }),
    getTools: async () => tools,
    executeTool: originalExecute,
  };
  return { mc, calls };
}

describe('installModelContextExecuteToolAdapter (WW-025)', () => {
  it('passes canonical (descriptor, input) calls straight through', async () => {
    const tools = [makeRegisteredTool('ui_preferences')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);

    const result = await mc.executeTool(tools[0], { action: 'set', theme: 'dark' });

    expect(JSON.parse(result)).toEqual({ tool: 'ui_preferences', input: { action: 'set', theme: 'dark' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].thisArg).toBe(mc);
    expect(calls[0].args[0]).toBe(tools[0]);
    expect(calls[0].args[1]).toEqual({ action: 'set', theme: 'dark' });
  });

  it('resolves (toolName, input) calls against getTools descriptors', async () => {
    const tools = [makeRegisteredTool('ui_navigate')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);

    const result = await mc.executeTool('ui_navigate', { path: '/journal' });

    expect(JSON.parse(result)).toEqual({ tool: 'ui_navigate', input: { path: '/journal' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe(tools[0]);
    expect(calls[0].args[1]).toEqual({ path: '/journal' });
  });

  it('delivers single-envelope { name, arguments } inputs to the tool handler', async () => {
    const tools = [makeRegisteredTool('ui_preferences')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);

    const result = await mc.executeTool({
      name: 'ui_preferences',
      arguments: { action: 'set', theme: 'dark' },
    });

    expect(JSON.parse(result)).toEqual({ tool: 'ui_preferences', input: { action: 'set', theme: 'dark' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe(tools[0]);
    expect(calls[0].args[1]).toEqual({ action: 'set', theme: 'dark' });
  });

  it('parses stringified envelope inputs and accepts input/params/args aliases', async () => {
    const tools = [makeRegisteredTool('ui_navigate')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);

    await mc.executeTool({ name: 'ui_navigate', arguments: JSON.stringify({ path: '/dashboards' }) });
    await mc.executeTool({ name: 'ui_navigate', input: { path: '/a' } });
    await mc.executeTool({ name: 'ui_navigate', params: { path: '/b' } });

    expect(calls.map((c) => c.args[1])).toEqual([
      { path: '/dashboards' },
      { path: '/a' },
      { path: '/b' },
    ]);
  });

  it('is idempotent: StrictMode re-install never double-wraps', async () => {
    const tools = [makeRegisteredTool('ui_preferences')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);
    const wrapped = mc.executeTool;
    installModelContextExecuteToolAdapter(mc);
    installModelContextExecuteToolAdapter(mc);

    expect(mc.executeTool).toBe(wrapped);
    await mc.executeTool(tools[0], { action: 'status' });
    expect(calls).toHaveLength(1);
  });

  it('rejects unknown tool names with a helpful error', async () => {
    const { mc } = makeFakeModelContext([makeRegisteredTool('ui_preferences')]);
    installModelContextExecuteToolAdapter(mc);

    await expect(mc.executeTool('no_such_tool', {})).rejects.toThrow('no registered tool named "no_such_tool"');
  });

  it('normalizes ui_navigate { href } alias (relative or full URL) into { path }', async () => {
    const { mc, calls } = makeFakeModelContext([makeRegisteredTool('ui_navigate')]);
    installModelContextExecuteToolAdapter(mc);

    await mc.executeTool({ name: 'ui_navigate', arguments: { href: 'https://wod.wiki/journal?q=test#top' } });
    expect(calls[0].args[1]).toEqual({
      href: 'https://wod.wiki/journal?q=test#top',
      path: '/journal?q=test#top',
    });
  });
});

describe('PlaygroundAgentProvider modelContext wiring (WW-025)', () => {
  afterEach(() => {
    const docAny = document as unknown as Record<string, unknown>;
    const navAny = navigator as unknown as Record<string, unknown>;
    delete docAny.modelContext;
    delete navAny.modelContext;
  });

  it('wraps document.modelContext (and a distinct navigator.modelContext) on mount', async () => {
    const docTools = [makeRegisteredTool('ui_preferences')];
    const navTools = [makeRegisteredTool('ui_navigate')];
    const docFake = makeFakeModelContext(docTools);
    const navFake = makeFakeModelContext(navTools);
    (document as unknown as Record<string, unknown>).modelContext = docFake.mc;
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: navFake.mc });

    let host: PlaygroundRenderResult | undefined;
    try {
      host = await renderWithPlaygroundHost(<PlaygroundAgentProvider />, { route: '/' });

      // Both distinct contexts are installed; wrapped executeTool normalizes
      // envelope calls end-to-end through the provider's own effect.
      await expect(docFake.mc.executeTool({ name: 'ui_preferences', arguments: { action: 'status' } })).resolves.toBeTruthy();
      expect(docFake.calls[0].args[0]).toBe(docTools[0]);
      expect(docFake.calls[0].args[1]).toEqual({ action: 'status' });

      await expect(navFake.mc.executeTool('ui_navigate', { path: '/journal' })).resolves.toBeTruthy();
      expect(navFake.calls[0].args[0]).toBe(navTools[0]);
      expect(navFake.calls[0].args[1]).toEqual({ path: '/journal' });
    } finally {
      await host?.cleanup();
    }
  });
});
