import { IRuntimeEventProvider } from '@bitcobblers/wod-wiki-engine';
import { IEvent } from '@bitcobblers/wod-wiki-engine';
import { Unsubscribe } from '@bitcobblers/wod-wiki-engine';
import { IRpcTransport } from './IRpcTransport';
import type { RpcMessage } from './RpcMessages';

/**
 * ChromecastEventProvider (browser side) — bridges events between
 * the local runtime and the Chromecast receiver over the RPC transport.
 *
 * - onEvent(handler): Listens for RpcEvent messages arriving from the
 *   receiver (e.g., D-Pad next/start/pause/stop) and delivers them
 *   to the handler. The browser wires this to runtime.handle(event).
 *
 * - dispatch(event): Sends an event from the browser to the receiver
 *   (not commonly used browser→receiver, but available for symmetry).
 */
export class ChromecastEventProvider implements IRuntimeEventProvider {
    private readonly handlers = new Set<(event: IEvent) => void>();
    private transportUnsub: (() => void) | null = null;
    private disposed = false;

    constructor(private readonly transport: IRpcTransport) {
        // Listen for RpcEvent messages from the receiver
        this.transportUnsub = this.transport.onMessage((message: RpcMessage) => {
            if (message.type === 'rpc-event') {
                const event: IEvent = {
                    name: message.name,
                    timestamp: new Date(message.timestamp),
                    data: message.data,
                };
                for (const handler of this.handlers) {
                    handler(event);
                }
            }
        });
    }

    dispatch(event: IEvent): void {
        if (this.disposed || !this.transport.connected) return;
        this.transport.send({
            type: 'rpc-event',
            name: event.name,
            timestamp: event.timestamp.getTime(),
            data: event.data,
        });
    }

    onEvent(handler: (event: IEvent) => void): Unsubscribe {
        if (this.disposed) return () => {};
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.transportUnsub?.();
        this.transportUnsub = null;
        this.handlers.clear();
    }
}
