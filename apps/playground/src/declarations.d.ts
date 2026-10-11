declare module '*.md?raw' {
    const content: string;
    export default content;
}

/** Vite `define` stamp from public/seed/<sourceId>/manifest.json — one entry per seed source (seed unification, multi-seed). */
declare const __SEED_VERSIONS__: Record<string, number>;
declare module '*.css';

/// <reference types="vite/client" />
