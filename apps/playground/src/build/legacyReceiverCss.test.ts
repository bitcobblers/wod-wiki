/**
 * legacyReceiverCss.test.ts — the receiver's CSS floor.
 *
 * The Cast Android TV engine is Chromium 92. Any CSS feature it lacks is
 * silently dropped by the engine, which is how the TV timer ended up with no
 * padding, no gaps and no clock size: the TV timer surface sizes itself in
 * container-query units (`cqw`), a Chromium 105 feature.
 */

import { describe, expect, it } from 'bun:test';
import { lowerReceiverCss } from './legacyReceiverCss';

const lower = (css: string): string => lowerReceiverCss(css, 'test.css').code;

describe('lowerReceiverCss', () => {
    it('unwraps @layer blocks so the engine keeps the rules', () => {
        const out = lower('@layer utilities{.a{color:red}}');

        expect(out).toContain('color:red');
        expect(out).not.toContain('@layer');
    });

    it('drops @property registrations', () => {
        const out = lower('@property --x{syntax:"<length>"}');

        expect(out).not.toContain('@property');
    });

    it('drops :has() rules and inert container declarations', () => {
        const out = lower('.a:has(.b){color:red}.c{container-type:inline-size;color:blue}');

        expect(out).not.toContain(':has(');
        expect(out).not.toContain('container-type');
        expect(out).toMatch(/color:(blue|#00f)/);
    });

    it('rewrites container-query units to viewport units', () => {
        const out = lower('.a{font-size:21cqw;padding:3cqw 4cqw;gap:1.2cqw;height:8.6cqh}');

        expect(out).toContain('font-size:21vw');
        expect(out).toContain('padding:3vw 4vw');
        expect(out).toContain('gap:1.2vw');
        expect(out).toContain('height:8.6vh');
        expect(out).not.toContain('cqw');
        expect(out).not.toContain('cqh');
    });

    it('rewrites dynamic viewport units', () => {
        const out = lower('.a{height:100dvh;min-height:calc(100dvh - 65px)}');

        expect(out).toContain('height:100vh');
        expect(out).toContain('min-height:calc(100vh - 65px)');
        expect(out).not.toContain('dvh');
    });

    it('folds individual transform properties into the transform shorthand', () => {
        const out = lower('.a{translate:var(--tw-translate-x) var(--tw-translate-y)}');
        expect(out).toContain('transform:translate(var(--tw-translate-x),var(--tw-translate-y))');

        const rotated = lower('.b{rotate:-45deg}');
        expect(rotated).toContain('transform:rotate(-45deg)');

        const scaled = lower('.c{scale:var(--tw-scale-x) var(--tw-scale-y)}');
        expect(scaled).toContain('transform:scale(var(--tw-scale-x),var(--tw-scale-y))');
    });

    it('applies individual transform properties before the transform shorthand', () => {
        const out = lower('.a{transform:rotate(3deg);translate:var(--tw-translate-x) var(--tw-translate-y)}');

        expect(out).toContain('transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(3deg)');
    });

    it('leaves escaped class names intact so the rules still match the markup', () => {
        // Tailwind escapes the unit into the class name: the markup carries
        // `h-[100dvh]`, so the selector must keep the original spelling.
        const out = lower('.h-\\[100dvh\\]{height:100dvh}');

        expect(out).toContain('.h-\\[100dvh\\]');
        expect(out).toContain('height:100vh');
    });
});
