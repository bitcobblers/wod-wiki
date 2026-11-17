import { IEvent } from '../contracts/events/IEvent';
import { IEventHandler } from '../contracts/events/IEventHandler';
import { IScriptRuntime } from '../contracts/IScriptRuntime';
import { NextAction } from '../actions/stack/NextAction';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { ThrowError } from '../actions/ThrowError';

export class NextEventHandler implements IEventHandler {
  private readonly _id: string;
  private readonly _name: string;

  constructor(id: string) {
    this._id = id;
    this._name = 'next-handler';
  }

  get id(): string {
    return this._id;
  }

  set id(_value: string) {
    throw new Error('Cannot modify readonly property id');
  }

  get name(): string {
    return this._name;
  }

  set name(_value: string) {
    throw new Error('Cannot modify readonly property name');
  }

  handler(event: IEvent, runtime: IScriptRuntime): IRuntimeAction[] {
    // Event filtering
    if (event.name !== 'next') {
      return [];
    }

    // Minimal validation: check runtime existence and non-empty stack
    if (!runtime || !runtime.stack || runtime.stack.count === 0) {
      return [ThrowError(new Error('Invalid runtime state for next event'), 'NextEventHandler')];
    }

    // Generate next action
    return [new NextAction(undefined, runtime.nowProvider)];
  }
}
