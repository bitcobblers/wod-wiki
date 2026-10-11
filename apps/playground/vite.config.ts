import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';
const CODEMIRROR_SINGLETON_DEPS = [
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-markdown',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/theme-one-dark',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
];

const pkg = JSON.parse(fs.readFileSync(resolve(import.meta.dirname, './package.json'), 'utf-8'));

// Auto-detect Tailscale SSL certs for HTTPS (required for Chromecast)
const projectRoot = resolve(import.meta.dirname, '../..');
const certFiles = fs.readdirSync(projectRoot).filter(f => f.endsWith('.ts.net.crt'));
const keyFiles = fs.readdirSync(projectRoot).filter(f => f.endsWith('.ts.net.key'));
const https = !process.env.VITE_NO_HTTPS && certFiles.length > 0 && keyFiles.length > 0
    ? { cert: fs.readFileSync(resolve(projectRoot, certFiles[0])), key: fs.readFileSync(resolve(projectRoot, keyFiles[0])) }
    : undefined;

const hmrHost = certFiles.length > 0 ? certFiles[0].replace('.crt', '') : undefined;


// Dev plugin: intercept receiver URLs and serve the RPC version through Vite's
// transform pipeline so that @vitejs/plugin-react injects its JSX preamble.
const receiverRedirectPlugin: Plugin = {
    name: 'receiver-redirect',
    configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
            const isReceiverUrl =
                req.url === '/receiver-rpc.html' ||
                req.url === '/receiver-rpc' ||
                req.url === '/receiver.html' ||
                req.url === '/receiver';
            if (isReceiverUrl) {
                try {
                    const htmlPath = resolve(import.meta.dirname, 'receiver-rpc.html');
                    const rawHtml = fs.readFileSync(htmlPath, 'utf-8');
                    const html = await server.transformIndexHtml('/receiver-rpc.html', rawHtml, req.originalUrl ?? '');
                    res.setHeader('Content-Type', 'text/html');
                    res.statusCode = 200;
                    res.end(html);
                } catch (err) {
                    next(err);
                }
                return;
            }
            next();
        });
    },
};

/**
 * Read the seed manifest versions stamped by scripts/sync-seed.ts (which runs
 * before vite in both dev and build): one entry per seed source —
 * `public/seed/<sourceId>/manifest.json`. A source with no manifest is
 * absent — the runtime then always consults that manifest instead of
 * trusting the skip-fetch fast path.
 */
function seedManifestVersions(): Record<string, number> {
    const seedDir = resolve(import.meta.dirname, 'public/seed');
    const versions: Record<string, number> = {};
    if (!fs.existsSync(seedDir)) return versions;
    for (const entry of fs.readdirSync(seedDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(resolve(seedDir, entry.name, 'manifest.json'), 'utf-8')) as { version?: unknown };
            if (typeof parsed.version === 'number' && parsed.version > 0) versions[entry.name] = parsed.version;
        } catch {
            // Absent/unreadable manifest → source not fast-pathable.
        }
    }
    return versions;
}

export default defineConfig({
    root: import.meta.dirname,
    envDir: projectRoot,
    base: process.env.VITE_BASE_PATH || '/',
    define: {
        // CI pipelines stamp the deployed artifact's version via VITE_APP_VERSION
        // (tagged version on main/prod, X.Y.Z-pr.N on PR previews); local dev
        // and library builds fall back to package.json.
        __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || pkg.version),
        // Seed version stamps (docs/prototypes/seed-data-unification.md §
        // Version check): read from the manifests the seed compiler just
        // wrote (generate runs before vite in both dev and build) — one
        // entry per seed source. Absent sources are not fast-pathable; the
        // runtime then always consults their manifest.
        __SEED_VERSIONS__: JSON.stringify(seedManifestVersions()),
    },
    plugins: [react(), receiverRedirectPlugin],
    resolve: {
        dedupe: ['react', 'react-dom', ...CODEMIRROR_SINGLETON_DEPS],
        alias: [
            { find: "url", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            { find: "node:url", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            { find: "path", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            { find: "node:path", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            { find: "fs", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            { find: "node:fs", replacement: resolve(import.meta.dirname, "../../scripts/empty-shim.ts") },
            // Workspace source aliases — instant HMR for packages/* edits with
            // zero build step. Most-specific first; dirs expand to their subtree.
            { find: '@bitcobblers/wod-wiki-lang/react', replacement: resolve(import.meta.dirname, '../../packages/lang/src/react.ts') },
            { find: /^@bitcobblers\/wod-wiki-ui\/styles\.css$/, replacement: resolve(import.meta.dirname, '../../packages/ui/src/styles.css') },
            { find: /^@bitcobblers\/wod-wiki-ui\/extensions$/, replacement: resolve(import.meta.dirname, '../../packages/ui/src/extensions/index.ts') },
            { find: '@bitcobblers/wod-wiki-core', replacement: resolve(import.meta.dirname, '../../packages/core/src') },
            { find: '@bitcobblers/wod-wiki-lang', replacement: resolve(import.meta.dirname, '../../packages/lang/src') },
            { find: '@bitcobblers/wod-wiki-wql', replacement: resolve(import.meta.dirname, '../../packages/wql/src') },
            { find: '@bitcobblers/wod-wiki-engine', replacement: resolve(import.meta.dirname, '../../packages/engine/src') },
            { find: '@bitcobblers/wod-wiki-ui', replacement: resolve(import.meta.dirname, '../../packages/ui/src') },
            { find: '@bitcobblers/wod-wiki-storage', replacement: resolve(import.meta.dirname, '../../packages/storage/src') },
            // `@/` -> ./src for app-support library imports (hooks, clock,
            // runtime views); application code itself lives under ./app.
            { find: '@', replacement: resolve(import.meta.dirname, 'src') },
        ],
    },
    server: {
        host: '0.0.0.0',
        ...(https ? { https } : {}),
        hmr: hmrHost ? { host: hmrHost } : true,
        // VITE_STORAGE=api dev sessions proxy the storage API to the local
        // wod-wiki-api server.
        proxy: {
            '/api': { target: 'http://localhost:3001', changeOrigin: true },
        },
    },
    build: {
        chunkSizeWarningLimit: 2000,
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, 'index.html'),
                // receiver-rpc.html is intentionally NOT built here: the Cast
                // Android TV engine is Chromium 92, and this pipeline emits
                // whole-app vendor chunks with no legacy JS lowering. The
                // receiver ships from vite.receiver.config.ts (chrome92
                // target + legacy CSS) — see _verify.yml "Build receiver".
            },
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    // CodeMirror + Lezer — large, stable, zero React deps; cache separately
                    if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('codemirror')) {
                        return 'vendor-codemirror';
                    }
                    // Everything else (React, router, recharts, zustand…) in one
                    // stable vendor chunk. Keeping them together avoids the circular
                    // dependency Rollup emits when React's scheduler is split out.
                    return 'vendor';
                },
            },
        },
    },
    css: {
        devSourcemap: true,
    },
    optimizeDeps: {
        exclude: ['@lezer/common'],
    },
});
