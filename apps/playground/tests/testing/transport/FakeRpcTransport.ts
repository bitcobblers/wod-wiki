import {
    FakeRpcTransport as CanonicalFakeRpcTransport,
    connectPair as canonicalConnectPair,
    type RpcUnsubscribe,
} from '@wod-wiki/lang-harness/transport/FakeRpcTransport';
import type { RpcMessage } from '@/services/cast/rpc/RpcMessages';

export type { RpcUnsubscribe };

export class FakeRpcTransport extends CanonicalFakeRpcTransport<RpcMessage> {}

export function connectPair(a: FakeRpcTransport, b: FakeRpcTransport): void {
    canonicalConnectPair(a, b);
}
