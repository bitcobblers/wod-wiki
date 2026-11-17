import { describe, it, expect, vi} from 'vitest';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';

describe('RuntimeStack', () => {
    const createMockBlock = (id: string): IRuntimeBlock => ({
        key: { toString: () => id } as any,
        label: id,
    } as IRuntimeBlock);

    it('should notify subscribers of push events', () => {
        const stack = new RuntimeStack();
        const listener = vi.fn();
        stack.subscribe(listener);

        const block = createMockBlock('block-1');
        stack.push(block);

        expect(listener).toHaveBeenCalledWith({ type: 'initial', blocks: [] });
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'push', block, depth: 1 }));
    });

    it('should notify subscribers of pop events', () => {
        const stack = new RuntimeStack();
        const block = createMockBlock('block-1');
        stack.push(block);

        const listener = vi.fn();
        stack.subscribe(listener);

        stack.pop();

        expect(listener).toHaveBeenCalledWith({ type: 'initial', blocks: [block] });
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'pop', block, depth: 0 }));
    });

    it('should notify subscribers of initial state', () => {
        const stack = new RuntimeStack();
        const block = createMockBlock('block-1');
        stack.push(block);

        const listener = vi.fn();
        stack.subscribe(listener);

        expect(listener).toHaveBeenCalledWith({ type: 'initial', blocks: [block] });
    });

    it('should notify multiple subscribers independently', () => {
        const stack = new RuntimeStack();
        const l1 = vi.fn();
        const l2 = vi.fn();

        stack.subscribe(l1);
        stack.subscribe(l2);

        const block = createMockBlock('block-1');
        stack.push(block);

        expect(l1).toHaveBeenCalledWith(expect.objectContaining({ type: 'push', block, depth: 1 }));
        expect(l2).toHaveBeenCalledWith(expect.objectContaining({ type: 'push', block, depth: 1 }));
    });

    it('should not notify unsubscribed listeners', () => {
        const stack = new RuntimeStack();
        const listener = vi.fn();
        const unsubscribe = stack.subscribe(listener);

        unsubscribe();
        stack.push(createMockBlock('block-1'));

        expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'push' }));
    });

    it('should emit pop events during clear', () => {
        const stack = new RuntimeStack();
        const b1 = createMockBlock('b1');
        const b2 = createMockBlock('b2');
        stack.push(b1);
        stack.push(b2);

        const listener = vi.fn();
        stack.subscribe(listener);

        stack.clear();

        // After popping b2, depth = 1; after popping b1, depth = 0
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'pop', block: b2, depth: 1 }));
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'pop', block: b1, depth: 0 }));
        expect(stack.count).toBe(0);
    });
});
