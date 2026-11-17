import { describe, it, expect, afterEach } from 'vitest';
import { TestScript } from '@wod-wiki/lang-harness/script';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describe('Rep-Scheme Inheritance', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    it('should inherit correct reps in each round of a 21-15-9 scheme', async () => {
        script = await TestScript.compile(`(21-15-9)
 pushups
 situps`);

        // User starts — WaitingToStart pops, Rounds block pushed, first child (pushups) pushed
        await script.next();

        // --- Round 1 (21 reps) ---
        let pushups = (await script.snapshot()).current;
        expect(pushups?.label).toContain('pushups');

        let repFragment = pushups?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);

        // Check inherited rep via memory
        expect(repFragment?.value).toBe(21);

        await script.next(); // pushups complete -> situps pushed

        let situps = (await script.snapshot()).current;
        expect(situps?.label).toContain('situps');
        repFragment = situps?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);
        expect(repFragment?.value).toBe(21);

        await script.next(); // situps complete -> Round 2 starts, pushups pushed

        // --- Round 2 (15 reps) ---
        pushups = (await script.snapshot()).current;
        expect(pushups?.label).toContain('pushups');
        repFragment = pushups?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);

        // This used to be stale (21)
        expect(repFragment?.value).toBe(15);

        await script.next(); // pushups complete -> situps pushed
        situps = (await script.snapshot()).current;
        repFragment = situps?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);
        expect(repFragment?.value).toBe(15);

        await script.next(); // situps complete -> Round 3 starts, pushups pushed

        // --- Round 3 (9 reps) ---
        pushups = (await script.snapshot()).current;
        repFragment = pushups?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);
        expect(repFragment?.value).toBe(9);

        await script.next(); // pushups complete -> situps pushed
        situps = (await script.snapshot()).current;
        repFragment = situps?.getMemoryByTag('metric:display')
            .flatMap(loc => loc.metrics.toArray())
            .find(f => f.type === MetricType.Rep);
        expect(repFragment?.value).toBe(9);

        await script.next(); // situps complete -> Rounds block complete -> Session complete
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});
