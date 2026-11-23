/**
 * WW-025: `installModelContextExecuteToolAdapter` normalizes the three
 * `modelContext.executeTool` call shapes agents actually use, so arguments
 * reach tool handlers instead of being defaulted to `{}` by the polyfill.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@bitcobblers/wod-wiki-ui/primitives';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { SettingsPage } from '../pages/SettingsPage';
import { AgentConfirmHost } from './AgentConfirmHost';
import {
  PlaygroundAgentProvider,
  installModelContextExecuteToolAdapter,
  uiSdkAgent,
} from './PlaygroundAgentProvider';

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

  it('installs a callTool alias that normalizes (name, args) and { name, arguments } (WW-112)', async () => {
    const tools = [makeRegisteredTool('ui_navigate')];
    const { mc, calls } = makeFakeModelContext(tools);
    installModelContextExecuteToolAdapter(mc);
    const mcWithCall = mc as typeof mc & { callTool?: (...args: unknown[]) => Promise<string> };

    expect(typeof mcWithCall.callTool).toBe('function');
    await mcWithCall.callTool!('ui_navigate', { path: '/notes' });
    await mcWithCall.callTool!({ name: 'ui_navigate', arguments: { path: '/efforts' } });
    expect(calls).toHaveLength(2);
    expect(calls[0].args[1]).toEqual({ path: '/notes' });
    expect(calls[1].args[1]).toEqual({ path: '/efforts' });
  });
});

describe('PlaygroundAgentProvider modelContext wiring (WW-025)', () => {
  afterEach(() => {
    const docAny = document as unknown as Record<string, unknown>;
    const navAny = navigator as unknown as Record<string, unknown>;
    delete docAny.modelContext;
    delete navAny.modelContext;
    delete navAny.modelContextTesting;
  });

  it('wraps document.modelContext (and a distinct navigator.modelContext) and exposes navigator.modelContextTesting on mount (WW-112)', async () => {
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

      const testing = (navigator as Navigator & {
        modelContextTesting?: {
          listTools: () => Promise<FakeRegisteredTool[]>;
          executeTool: (...args: unknown[]) => Promise<string>;
          callTool: (...args: unknown[]) => Promise<string>;
        };
      }).modelContextTesting;
      expect(testing).toBeDefined();
      expect(await testing!.listTools()).toEqual(navTools);
      await expect(testing!.callTool('ui_navigate', { path: '/dashboards' })).resolves.toBeTruthy();
      expect(navFake.calls[1].args[1]).toEqual({ path: '/dashboards' });
    } finally {
      await host?.cleanup();
    }
  });

  it('registers ui-sdk snapshot/act/query tools and drives Settings controls + AgentConfirmHost gate', async () => {
    const registeredNames: string[] = [];
    const docFake = makeFakeModelContext([]);
    docFake.mc.registerTool = async (tool?: { name?: string }) => {
      if (tool?.name) registeredNames.push(tool.name);
      return { unregister() {} };
    };
    (document as unknown as Record<string, unknown>).modelContext = docFake.mc;
    const onDanger = vi.fn();

    let host: PlaygroundRenderResult | undefined;
    try {
      host = await renderWithPlaygroundHost(
        <>
          <PlaygroundAgentProvider />
          <AgentConfirmHost />
          <SettingsPage />
          <Button
            variant="destructive"
            data-agent-confirm="Permanently deletes the test notebook"
            onClick={onDanger}
          >
            Delete test notebook
          </Button>
        </>,
        { route: '/settings/system' },
      );

      expect(registeredNames).toEqual(expect.arrayContaining(['snapshot', 'act', 'query']));

      const components = uiSdkAgent
        .snapshot()
        .filter((entry) => !entry.offPage && entry.component !== 'more');
      for (const entry of components) {
        expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
      }
      const labels = components.map((entry) => entry.label);
      for (const expected of [
        'Workout Sound Effects',
        'Debug Mode',
        'Share Anonymous Usage Statistics',
        'Reset & Clear Cache',
        'Delete test notebook',
      ]) {
        expect(labels, `${expected} missing from snapshot`).toContain(expected);
      }

      const debugSwitch = screen.getByTestId('debug-mode-toggle');
      const beforeDebug = debugSwitch.getAttribute('aria-checked');
      const toggleResult = await uiSdkAgent.act({
        steps: [{ ref: 'Debug Mode', action: 'toggle' }],
      });
      expect(toggleResult.ok, toggleResult.error?.message).toBe(true);
      expect(debugSwitch.getAttribute('aria-checked')).toBe(
        beforeDebug === 'true' ? 'false' : 'true',
      );

      const deniedPromise = uiSdkAgent.act({
        steps: [{ ref: 'Delete test notebook', action: 'press' }],
      });
      const denyBtn = await screen.findByTestId('agent-confirm-cancel');
      fireEvent.click(denyBtn);
      const deniedResult = await deniedPromise;
      expect(deniedResult.ok).toBe(false);
      expect(onDanger).not.toHaveBeenCalled();

      const approvedPromise = uiSdkAgent.act({
        steps: [{ ref: 'Delete test notebook', action: 'press' }],
      });
      const approveBtn = await screen.findByTestId('agent-confirm-approve');
      fireEvent.click(approveBtn);
      const approvedResult = await approvedPromise;
      expect(approvedResult.ok, approvedResult.error?.message).toBe(true);
      expect(onDanger).toHaveBeenCalledTimes(1);
    } finally {
      await host?.cleanup();
    }
  });
});
