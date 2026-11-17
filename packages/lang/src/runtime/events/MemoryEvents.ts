import { IEvent } from '../contracts/events/IEvent';
import { IMemoryReference } from '../contracts/IMemoryReference';
import { INowProvider, wallClockNow } from '../INowProvider';
/**
 * Base class for memory events.
 */
abstract class BaseMemoryEvent implements IEvent {
  abstract readonly name: string;
  readonly timestamp: Date;

  protected constructor(now: INowProvider = wallClockNow) {
    this.timestamp = now.now();
  }
}

/**
 * Event dispatched when a memory location is allocated.
 */
export class MemoryAllocateEvent extends BaseMemoryEvent {
  readonly name = 'memory:allocate';
  readonly data: {
    ref: IMemoryReference;
    value: unknown;
  };

  constructor(ref: IMemoryReference, value: unknown, now: INowProvider = wallClockNow) {
    super(now);
    this.data = { ref, value };
  }
}

/**
 * Event dispatched when a memory value is set/updated.
 */
export class MemorySetEvent extends BaseMemoryEvent {
  readonly name = 'memory:set';
  readonly data: {
    ref: IMemoryReference;
    value: unknown;
    oldValue: unknown;
  };

  constructor(ref: IMemoryReference, value: unknown, oldValue: unknown, now: INowProvider = wallClockNow) {
    super(now);
    this.data = { ref, value, oldValue };
  }
}

/**
 * Event dispatched when a memory location is released.
 */
export class MemoryReleaseEvent extends BaseMemoryEvent {
  readonly name = 'memory:release';
  readonly data: {
    ref: IMemoryReference;
    lastValue: unknown;
  };

  constructor(ref: IMemoryReference, lastValue: unknown, now: INowProvider = wallClockNow) {
    super(now);
    this.data = { ref, lastValue };
  }
}
