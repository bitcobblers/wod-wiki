import { IRuntimeAction } from '../../contracts/IRuntimeAction';
import type { IRuntimeContext } from '../../contracts/IRuntimeContext';
import type { IEventDispatchContext } from '../../contracts/primitives/IEventDispatchContext';
import { IEventHandler } from '../../contracts/events/IEventHandler';
import { IEvent } from '../../contracts/events/IEvent';
import { HandlerScope } from '../../contracts/events/IEventBus';

export class SubscribeEventAction implements IRuntimeAction {
    private readonly _type = 'subscribe-event';

    constructor(
        private readonly eventName: string,
        private readonly handlerId: string,
        private readonly ownerId: string,
        private readonly handlerFn: (event: IEvent, runtime: IRuntimeContext) => IRuntimeAction[],
        /** Handler scope. Default: 'active' (only fires when owner is current block) */
        private readonly scope: HandlerScope = 'active'
    ) { }

    get type(): string {
        return this._type;
    }

    /* istanbul ignore next */
    set type(_value: string) {
        throw new Error('Cannot modify readonly property type');
    }

    do(runtime: IRuntimeContext): void {
        const handler: IEventHandler = {
            id: this.handlerId,
            name: `Subscription-${this.eventName}`,
            handler: this.handlerFn as unknown as (event: IEvent, runtime: IEventDispatchContext) => IRuntimeAction[]
        };
        runtime.eventBus.register(this.eventName, handler, this.ownerId, { scope: this.scope });
    }
}

export class UnsubscribeEventAction implements IRuntimeAction {
    private readonly _type = 'unsubscribe-event';

    constructor(
        private readonly handlerId: string
    ) { }

    get type(): string {
        return this._type;
    }

    /* istanbul ignore next */
    set type(_value: string) {
        throw new Error('Cannot modify readonly property type');
    }

    do(runtime: IRuntimeContext): void {
        runtime.eventBus.unregisterById(this.handlerId);
    }
}
