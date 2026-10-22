/**
 * legacyReceiverCss.ts — lower receiver CSS to the Cast Android TV floor.
 *
 * The receiver runs on the Cast Android TV engine: Chromium 92 (CrKey UA,
 * verified on a real device). Three passes, in order:
 *
 *   1. postcss
 *      a. unwrap `@layer` blocks — Tailwind v4 emits every rule inside
 *         `@layer`, and Chromium < 99 discards those blocks wholesale, so the
 *         receiver would render with no styling at all.
 *      b. drop `@property` registrations — unsupported; old parsers skip them.
 *      c. container-query units (`cqw`, `cqh`, …) → viewport units. The TV
 *         timer surface sizes its padding, gaps, clock type and buttons
 *         against its `@container` root, and Chromium 92 has no container
 *         queries: every `cqw` declaration is dropped, so the timer collapses
 *         (no padding, no gaps, no clock size, buttons at zero size).
 *         The receiver's timer surface is full-bleed (`h-screen w-screen`),
 *         so the container is the viewport and `cqw` → `vw` is faithful
 *         there. It is not exact: a container-query unit resolves against the
 *         container's *content* box (inside the surface's own padding),
 *         while `vw` resolves against the viewport — the legacy sizes come
 *         out ~9% larger on a 1280px screen. The layout is right and nothing
 *         overflows; the scale is a shade off the design.
 *      d. dynamic viewport units (`dvh`, `svh`, `lvh`, …) → `vh`/`vw`
 *         (Chromium 108+).
 *      e. individual transform properties (`translate`, `rotate`, `scale` —
 *         Chromium 104+) → the `transform` shorthand, applied in the spec
 *         order (translate → rotate → scale, then the shorthand).
 *   2. lightningcss at chrome 87 — lowers oklch/lab colors to hex/rgb
 *      fallbacks, keeping modern values behind `@supports` upgrades.
 *
 * The CSS *selectors* are never rewritten: Tailwind escapes units into class
 * names (`.h-\[100dvh\]`), and those class names must keep matching the
 * markup. Only declaration values are rewritten.
 */

import postcss from 'postcss';
import { transform as lightningTransform } from 'lightningcss';

/** lightningcss packs versions as `major << 16 | minor << 8 | patch`. */
const CHROME_TARGET = 87 << 16;

/**
 * Unit rewrites. Each entry maps a unit to its viewport equivalent; the
 * numeric factor is preserved.
 */
const UNIT_REWRITES: ReadonlyArray<{
    pattern: RegExp;
    replace: (factor: string) => string;
}> = [
    // Container-query units (Chromium 105+).
    { pattern: /(\d*\.?\d+)cqw\b/g, replace: (f) => `${f}vw` },
    { pattern: /(\d*\.?\d+)cqh\b/g, replace: (f) => `${f}vh` },
    { pattern: /(\d*\.?\d+)cqi\b/g, replace: (f) => `${f}vw` },
    { pattern: /(\d*\.?\d+)cqb\b/g, replace: (f) => `${f}vw` },
    { pattern: /(\d*\.?\d+)cqmin\b/g, replace: (f) => `min(${f}vw,${f}vh)` },
    { pattern: /(\d*\.?\d+)cqmax\b/g, replace: (f) => `max(${f}vw,${f}vh)` },
    // Dynamic viewport units (Chromium 108+).
    { pattern: /(\d*\.?\d+)[dsl]vh\b/g, replace: (f) => `${f}vh` },
    { pattern: /(\d*\.?\d+)[dsl]vw\b/g, replace: (f) => `${f}vw` },
    { pattern: /(\d*\.?\d+)[dsl]vmin\b/g, replace: (f) => `min(${f}vw,${f}vh)` },
    { pattern: /(\d*\.?\d+)[dsl]vmax\b/g, replace: (f) => `max(${f}vw,${f}vh)` },
];

/** Split a value on top-level whitespace (whitespace inside functions stays). */
function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of value) {
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        if (/\s/.test(char) && depth === 0) {
            if (current) parts.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (current) parts.push(current);
    return parts;
}

/**
 * Fold the individual transform properties of one rule into a single
 * `transform` declaration, in the order the spec applies them
 * (translate → rotate → scale, then the `transform` shorthand).
 */
function foldTransformProperties(root: postcss.Root): void {
    root.walkRules((rule) => {
        const translate: string[] = [];
        const rotate: string[] = [];
        const scale: string[] = [];

        rule.each((node) => {
            if (node.type !== 'decl') return;
            if (node.prop === 'translate') {
                translate.push(...splitTopLevel(node.value));
                node.remove();
            } else if (node.prop === 'rotate') {
                // The `rotate` property takes an angle plus an optional axis;
                // Tailwind emits one angle per axis, and the x axis is the one
                // utilities use. The legacy `rotate()` takes a single angle.
                const [angle] = splitTopLevel(node.value);
                if (angle) rotate.push(angle);
                node.remove();
            } else if (node.prop === 'scale') {
                scale.push(...splitTopLevel(node.value));
                node.remove();
            }
        });

        if (!translate.length && !rotate.length && !scale.length) return;

        const parts: string[] = [];
        if (translate.length) parts.push(`translate(${translate.join(',')})`);
        if (rotate.length) parts.push(`rotate(${rotate.join(',')})`);
        if (scale.length) parts.push(`scale(${scale.join(',')})`);
        const composed = parts.join(' ');

        const shorthand = rule.nodes?.find(
            (node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'transform',
        );
        if (shorthand) {
            // The individual properties apply before the shorthand.
            shorthand.value = `${composed} ${shorthand.value}`;
        } else {
            rule.append({ prop: 'transform', value: composed });
        }
    });
}

/** Rewrite unsupported units in declaration values (never in selectors). */
function lowerUnits(root: postcss.Root): void {
    root.walkDecls((decl) => {
        if (!decl.value) return;
        let value = decl.value;
        for (const { pattern, replace } of UNIT_REWRITES) {
            value = value.replace(pattern, (_match, factor: string) => replace(factor));
        }
        decl.value = value;
    });
}

/**
 * Lower a receiver stylesheet to the Chromium 92 feature floor.
 *
 * @param css     Stylesheet source (as emitted by the Vite CSS pipeline).
 * @param filename Name used for source maps and error messages.
 */
export function lowerReceiverCss(css: string, filename: string): { code: string; map?: string } {
    const root = postcss.parse(css, { from: filename });

    // 1a. @layer blocks: unwrap in document order.
    root.walkAtRules('layer', (rule) => {
        if (rule.nodes && rule.nodes.length > 0) {
            rule.replaceWith(...rule.nodes);
        } else {
            rule.remove();
        }
    });
    // 1b. @property registrations.
    root.walkAtRules('property', (rule) => {
        rule.remove();
    });

    // 1b2. `:has()` selectors (Chromium 105+). The engine drops such a rule
    // whole — including the other selectors in its list — so removing it
    // here preserves the rendered result and keeps the sheet small.
    root.walkRules((rule) => {
        if (rule.selector.includes(':has(')) rule.remove();
    });

    // 1b3. `container-type` / `container-name` (Chromium 105+). Without
    // container queries the container is inert — the units it sized have
    // been rewritten to viewport units already.
    root.walkDecls((decl) => {
        if (/^container(-type|-name)?$/.test(decl.prop)) decl.remove();
    });

    // 1c-1e. Units and transform properties.
    lowerUnits(root);
    foldTransformProperties(root);

    // 2. Colors and any remaining modern syntax.
    const { code, map } = lightningTransform({
        filename,
        code: Buffer.from(root.toString()),
        minify: true,
        sourceMap: true,
        targets: { chrome: CHROME_TARGET },
    });
    return {
        code: typeof code === 'string' ? code : Buffer.from(code).toString('utf-8'),
        map: map ? Buffer.from(map).toString('utf-8') : undefined,
    };
}
