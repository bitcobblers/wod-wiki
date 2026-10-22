/**
 * check-receiver-css-compat.cjs — the receiver's CSS feature floor.
 *
 * The Cast Android TV engine is Chromium 92. The engine silently drops any
 * CSS feature it does not implement: a `cqw` declaration vanishes, and a
 * layout built on it collapses. The receiver build lowers the modern
 * features (see apps/playground/src/build/legacyReceiverCss.ts), but nothing
 * stopped a new one from creeping in — the TV timer once shipped with
 * container-query units and lost every size on the device.
 *
 * This check parses the built receiver stylesheet and fails when it uses a
 * feature Chromium 92 lacks. Support comes from caniuse-lite, so the floor is
 * not hand-maintained.
 *
 *   bun scripts/check-receiver-css-compat.cjs [path/to/receiver.css]
 *
 * With no argument it checks the receiver stylesheet in the playground build
 * output (apps/playground/dist/assets/receiver-*.css).
 */

const { readdirSync, readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const postcss = require('postcss');
const { feature } = require('caniuse-lite');

const CHROME_VERSION = '92';

/** caniuse-lite reports 'y' when the browser has the feature, 'n' when not. */
function chromeSupports(featureId) {
    const data = feature(require(`caniuse-lite/data/features/${featureId}`));
    return String(data.stats.chrome[CHROME_VERSION] ?? 'unknown').startsWith('y');
}

/**
 * Features Chromium 92 does not have. `detect` runs against the parsed
 * stylesheet; a hit means the engine would drop that part of the sheet.
 */
const UNSUPPORTED_FEATURES = [
    {
        id: 'css-container-queries',
        label: 'container queries (container-type / @container)',
        detect(root) {
            const hits = [];
            root.walkDecls((decl) => {
                if (/^container(-type|-name)?$/.test(decl.prop)) hits.push(`${decl.prop}: ${decl.value}`);
            });
            root.walkAtRules('container', (rule) => hits.push(`@container ${rule.params}`));
            return hits;
        },
    },
    {
        id: 'css-container-query-units',
        label: 'container-query units (cqw / cqh)',
        detect(root) {
            const hits = [];
            root.walkDecls((decl) => {
                if (/\d(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/.test(decl.value)) hits.push(`${decl.prop}: ${decl.value}`);
            });
            return hits;
        },
    },
    {
        id: 'viewport-unit-variants',
        label: 'dynamic viewport units (dvh / svh / lvh)',
        detect(root) {
            const hits = [];
            root.walkDecls((decl) => {
                if (/\d[dsl](vh|vw|vmin|vmax)\b/.test(decl.value)) hits.push(`${decl.prop}: ${decl.value}`);
            });
            return hits;
        },
    },
    {
        // caniuse has no feature id for the individual transform properties;
        // they shipped in Chrome 104.
        chromeVersion: 104,
        label: 'individual transform properties (translate / rotate / scale)',
        detect(root) {
            const hits = [];
            root.walkDecls((decl) => {
                if (['translate', 'rotate', 'scale'].includes(decl.prop)) hits.push(`${decl.prop}: ${decl.value}`);
            });
            return hits;
        },
    },
    {
        id: 'css-has',
        label: ':has() selectors',
        detect(root) {
            const hits = [];
            root.walkRules((rule) => {
                if (rule.selector.includes(':has(')) hits.push(rule.selector);
            });
            return hits;
        },
    },
    {
        id: 'css-subgrid',
        label: 'subgrid',
        detect(root) {
            const hits = [];
            root.walkDecls((decl) => {
                if (/subgrid/.test(decl.value)) hits.push(`${decl.prop}: ${decl.value}`);
            });
            return hits;
        },
    },
    {
        id: 'css-cascade-layers',
        label: '@layer blocks',
        detect(root) {
            const hits = [];
            root.walkAtRules('layer', (rule) => hits.push(`@layer ${rule.params}`));
            return hits;
        },
    },
    {
        id: 'css-nesting',
        label: 'nested rules',
        detect(root) {
            const hits = [];
            root.walkRules((rule) => {
                if (rule.nodes && rule.nodes.some((node) => node.type === 'rule')) hits.push(rule.selector);
            });
            return hits;
        },
    },
];

function resolveInput() {
    const argument = process.argv[2];
    if (argument) return resolve(argument);
    const assetsDir = resolve(__dirname, '../apps/playground/dist/assets');
    if (!existsSync(assetsDir)) return null;
    const receiverCss = readdirSync(assetsDir).filter((file) => file.startsWith('receiver-') && file.endsWith('.css'));
    if (!receiverCss.length) return null;
    return resolve(assetsDir, receiverCss[0]);
}

const input = resolveInput();
if (!input) {
    console.error('No receiver stylesheet found. Build the receiver first:');
    console.error('  bun x vite build --config apps/playground/vite.receiver.config.ts --outDir dist');
    process.exit(1);
}

const root = postcss.parse(readFileSync(input, 'utf-8'), { from: input });
const violations = [];

for (const { id, label, detect, chromeVersion } of UNSUPPORTED_FEATURES) {
    const supported = chromeVersion ? CHROME_VERSION >= chromeVersion : chromeSupports(id);
    if (supported) continue;
    const hits = detect(root);
    if (!hits.length) continue;
    violations.push(
        `  ${label} (Chrome ${CHROME_VERSION}: unsupported)`,
        ...hits.slice(0, 5).map((hit) => `    ${hit}`),
        ...(hits.length > 5 ? [`    …and ${hits.length - 5} more`] : []),
    );
}

if (violations.length) {
    console.error(`Receiver CSS uses features Chrome ${CHROME_VERSION} (Cast Android TV) does not support:`);
    console.error(violations.join('\n'));
    console.error('\nLower them in apps/playground/src/build/legacyReceiverCss.ts.');
    process.exit(1);
}

console.log(`Receiver CSS is Chrome ${CHROME_VERSION}-compatible: ${input}`);
