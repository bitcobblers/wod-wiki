import { describe, it, expect, beforeEach } from 'bun:test';
import type { IRpcTransport, RpcUnsubscribe } from '../IRpcTransport';
import type { RpcMessage, WorkbenchDisplayState } from '../RpcMessages';
import {
  createReceiverSession,
  type ReceiverSessionDeps,
} from '../ReceiverSessionManager';

class MockTransport implements IRpcTransport {
  connected = true;
  sent: RpcMessage[] = [];
  private messageHandlers = new Set<(m: RpcMessage) => void>();
  private disconnectedHandlers = new Set<() => void>();
  private connectedHandlers = new Set<() => void>();

  send(message: RpcMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (m: RpcMessage) => void): RpcUnsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnected(handler: () => void): RpcUnsubscribe {
    this.connectedHandlers.add(handler);
    return () => this.connectedHandlers.delete(handler);
  }

  onDisconnected(handler: () => void): RpcUnsubscribe {
    this.disconnectedHandlers.add(handler);
    return () => this.disconnectedHandlers.delete(handler);
  }

  get needsClockSync(): boolean {
    return false;
  }
  async connect(): Promise<void> {}
  dispose(): void {}

  receive(msg: RpcMessage): void {
    for (const h of [...this.messageHandlers]) h(msg);
  }

  disconnect(): void {
    for (const h of [...this.disconnectedHandlers]) h();
  }
}

function makeDeps(nowMs = 10_000): {
  deps: ReceiverSessionDeps;
  playCalls: { name: string; volume: number }[];
  setEnabledCalls: boolean[];
} {
  const playCalls: { name: string; volume: number }[] = [];
  const setEnabledCalls: boolean[] = [];
  return {
    deps: {
      now: { now: () => new Date(nowMs), nowMs: () => nowMs },
      playAudio: (name, volume) => {
        playCalls.push({ name, volume });
      },
      setAudioEnabled: (enabled) => {
        setEnabledCalls.push(enabled);
      },
    },
    playCalls,
    setEnabledCalls,
  };
}

describe('createReceiverSession (stateless frame receiver)', () => {
  let transport: MockTransport;
  let mgr: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    transport = new MockTransport();
    mgr = makeDeps(10_000);
  });

  it('enables audio by default and routes rpc-audio messages', () => {
    const handle = createReceiverSession(transport, undefined, mgr.deps);
    expect(mgr.setEnabledCalls).toEqual([true]);

    transport.receive({ type: 'rpc-audio', name: 'beep', volume: 0.75 });
    expect(mgr.playCalls).toEqual([{ name: 'beep', volume: 0.75 }]);
    handle.dispose();
  });

  it('skips enabling audio when options.audio = false', () => {
    const handle = createReceiverSession(transport, { audio: false }, mgr.deps);
    expect(mgr.setEnabledCalls).toEqual([]);
    handle.dispose();
  });

  it('answers clock-sync requests and applies clockOffsetMs to getSenderNowMs()', () => {
    const handle = createReceiverSession(transport, { audio: false }, mgr.deps);
    transport.receive({ type: 'rpc-clock-sync-request', timestamp: 9_500 });
    expect(transport.sent).toEqual([
      {
        type: 'rpc-clock-sync-response',
        requestTimestamp: 9_500,
        receiverTimestamp: 10_000,
      },
    ]);

    transport.receive({ type: 'rpc-clock-sync-result', offsetMs: 400, rttMs: 20 });
    expect(handle.getSenderNowMs()).toBe(9_600);
    handle.dispose();
  });

  it('preserves previewData title across active mode transitions and clears sessionFrame on idle', () => {
    const handle = createReceiverSession(transport, { audio: false }, mgr.deps);
    const states: WorkbenchDisplayState[] = [];
    handle.onWorkbenchUpdate((s) => states.push(s));

    transport.receive({
      type: 'rpc-workbench-update',
      mode: 'preview',
      previewData: { title: 'Fran', blocks: [] },
    });
    transport.receive({
      type: 'rpc-workbench-update',
      mode: 'active',
    });

    expect(states[states.length - 1]).toEqual({
      mode: 'active',
      previewData: { title: 'Fran', blocks: [] },
    });
    handle.dispose();
  });

  it('forwards transport disconnect and stops processing after idempotent dispose()', () => {
    const handle = createReceiverSession(transport, { audio: false }, mgr.deps);
    const calls: number[] = [];
    handle.onDisconnected(() => calls.push(1));

    transport.disconnect();
    expect(calls).toEqual([1]);

    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();

    transport.receive({ type: 'rpc-audio', name: 'beep', volume: 0.5 });
    expect(mgr.playCalls).toEqual([]);
  });
});
