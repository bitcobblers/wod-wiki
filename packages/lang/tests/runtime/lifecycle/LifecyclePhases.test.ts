import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BehaviorTestHarness } from '@wod-wiki/lang-harness/harness/BehaviorTestHarness';
import { MockBlock } from '@wod-wiki/lang-harness/harness/MockBlock';

// We can test lifecycle methods by observing when behaviors are called
// Since we are using MockBlock, we can spy on behaviors,
// OR we can test the specific Lifecycle behaviors if they exist (e.g. MountBehavior).
// But "MountBehavior" isn't a standard behavior class usually, it's a phase.
// However, some strategies add specific behaviors for specific phases.

// If the plan means "Test the lifecycle PHASES of the Runtime/Block interaction",
// we can do that using the Harness and custom behaviors.

class LifecycleSpyBehavior {
    mountCalled = false;
    nextCalled = false;
    unmountCalled = false;

    onPush() { this.mountCalled = true; return []; }
    onNext() { this.nextCalled = true; return []; }
    onPop() { this.unmountCalled = true; return []; }
}

describe('Lifecycle Phases', () => {
    let harness: BehaviorTestHarness;

    beforeEach(() => {
        harness = new BehaviorTestHarness();
    });

    afterEach(() => {
        harness?.dispose();
    });

    it('should trigger onPush during mount phase', () => {
        const spy = new LifecycleSpyBehavior();
        const block = new MockBlock('lifecycle-test', [spy]);

        harness.push(block);
        harness.mount();

        expect(spy.mountCalled).toBe(true);
    });

    it('should trigger onNext during next phase', () => {
        const spy = new LifecycleSpyBehavior();
        const block = new MockBlock('lifecycle-test', [spy]);

        harness.push(block);
        harness.mount();
        harness.next();

        expect(spy.nextCalled).toBe(true);
    });

    it('should trigger onPop during unmount phase', () => {
        const spy = new LifecycleSpyBehavior();
        const block = new MockBlock('lifecycle-test', [spy]);

        harness.push(block);
        harness.mount();
        harness.unmount();

        expect(spy.unmountCalled).toBe(true);
    });
});
