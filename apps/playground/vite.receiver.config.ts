/**
 * Vite config for building the Chromecast RPC receiver as a standalone page.
 *
 * Used by `postbuild-storybook` to compile receiver-rpc.html + its bundled
 * JS/CSS into storybook-static/ so it's served alongside Storybook on
 * GitHub Pages.
 *
 * Also used by `dev:app` when the receiver needs its own dev server,
 * but the primary dev path is via the Storybook middleware in .storybook/main.mjs.
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';
import { lowerReceiverCss } from './src/build/legacyReceiverCss';

/**
 * Lowers the emitted receiver CSS for Chromecast firmware Chromium /
 * Android System WebView (Chromium 92, verified on a real device).
 *
 * The lowering itself lives in `src/build/legacyReceiverCss.ts` — it unwraps
 * `@layer` blocks (Tailwind v4 emits every rule inside `@layer`, which those
 * engines discard wholesale — the receiver would render with no styling at
 * all), drops `@property` registrations, and rewrites the CSS features
 * Chromium 92 does not have: container-query units (`cqw` — the TV timer
 * surface sizes itself in them), dynamic viewport units (`dvh`) and the
 * individual transform properties (`translate`/`rotate`/`scale`). Colors are
 * lowered by lightningcss at chrome 87, keeping modern values behind
 * `@supports` upgrades.
 *
 * Dev-server rendering (local debug tab) is untouched; only the built
 * artifact is rewritten. See docs/cast-research/chromecast-receiver-css-legacy.md.
 */
let resolvedAssetsDir = '';

const legacyReceiverCssPlugin = (): Plugin => ({
    name: 'legacy-receiver-css',
    apply: 'build',
    // Resolved at config time so the CSS pass rewrites the assets directory
    // the build actually used (CI overrides outDir to apps/playground/dist).
    configResolved(config) {
        resolvedAssetsDir = resolve(config.root, config.build.outDir, 'assets');
    },
    closeBundle() {
        const assetsDir = resolvedAssetsDir;
        if (!assetsDir || !fs.existsSync(assetsDir)) return;
        const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.startsWith('receiver-') && f.endsWith('.css'));
        for (const file of cssFiles) {
            const filePath = resolve(assetsDir, file);
            const { code, map } = lowerReceiverCss(fs.readFileSync(filePath, 'utf-8'), file);
            fs.writeFileSync(filePath, `${code}\n/*# sourceMappingURL=${file}.map */`);
            if (map) fs.writeFileSync(`${filePath}.map`, map);
        }
    },
});

export default defineConfig({
    // Root is this app directory so that /app/receiver-rpc.tsx in
    // receiver-rpc.html resolves to apps/playground/app/receiver-rpc.tsx.
    root: import.meta.dirname,
    // Relative base so assets resolve correctly whether served at / or a subpath
    base: './',
    plugins: [react(), legacyReceiverCssPlugin()],
    resolve: {
        alias: {
            // Same workspace source aliases as the main app config so the
            // receiver builds without a prior packages tsup build.
            '@bitcobblers/wod-wiki-lang/react': resolve(import.meta.dirname, '../../packages/lang/src/react.ts'),
            '@bitcobblers/wod-wiki-ui/styles.css': resolve(import.meta.dirname, '../../packages/ui/src/styles.css'),
            '@bitcobblers/wod-wiki-ui/extensions': resolve(import.meta.dirname, '../../packages/ui/src/extensions/index.ts'),
            '@bitcobblers/wod-wiki-core': resolve(import.meta.dirname, '../../packages/core/src'),
            '@bitcobblers/wod-wiki-lang': resolve(import.meta.dirname, '../../packages/lang/src'),
            '@bitcobblers/wod-wiki-storage': resolve(import.meta.dirname, '../../packages/storage/src'),
            '@bitcobblers/wod-wiki-wql': resolve(import.meta.dirname, '../../packages/wql/src'),
            '@bitcobblers/wod-wiki-engine': resolve(import.meta.dirname, '../../packages/engine/src'),
            '@bitcobblers/wod-wiki-ui': resolve(import.meta.dirname, '../../packages/ui/src'),
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    build: {
        // Cast Android TV receivers run Chromium 92 (CrKey UA, verified on a
        // real device). esbuild lowers ES2022 syntax — class static blocks
        // (the crash: SyntaxError on `static {}` in @radix-ui/react-collection),
        // ??=/||=, private methods — to that target. Runtime APIs the
        // lowering cannot provide are shimmed inline in receiver-rpc.html.
        target: 'chrome92',
        // Merge into the repo-root dist/ that the PR pipeline just
        // downloaded (playground-dist artifact) before the S3 sync, so the
        // Chromecast receiver page ships on the preview origin.
        outDir: resolve(import.meta.dirname, '../../dist'),
        // Do NOT empty — the playground bundle already populated this directory
        emptyOutDir: false,
        sourcemap: true,
        rollupOptions: {
            input: {
                'receiver-rpc': resolve(import.meta.dirname, 'receiver-rpc.html'),
            },
            output: {
                // Put JS/CSS in assets/ matching Storybook's convention
                entryFileNames: 'assets/receiver-[name]-[hash].js',
                chunkFileNames: 'assets/receiver-[name]-[hash].js',
                assetFileNames: 'assets/receiver-[name]-[hash][extname]',
            },
        },
    },
    css: {
        devSourcemap: true,
    },
});
