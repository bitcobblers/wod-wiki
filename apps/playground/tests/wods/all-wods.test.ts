import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { TestScript } from '@/testing/script';

/**
 * Recursively find all markdown files in a directory.
 */
function findMarkdownFiles(dir: string, fileList: string[] = []): string[] {
    const files = readdirSync(dir);
    for (const file of files) {
        const filePath = join(dir, file);
        if (statSync(filePath).isDirectory()) {
            findMarkdownFiles(filePath, fileList);
        } else if (file.endsWith('.md')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

/**
 * Extract WOD blocks from markdown content.
 */
function extractScriptBlocks(content: string): string[] {
    const blocks: string[] = [];
    const startMarker = '```time';
    const endMarker = '```';

    let startIndex = content.indexOf(startMarker);
    while (startIndex !== -1) {
        const contentStart = startIndex + startMarker.length;
        const endIndex = content.indexOf(endMarker, contentStart);
        if (endIndex === -1) break;

        const block = content.substring(contentStart, endIndex).trim();
        if (block) {
            blocks.push(block);
        }

        startIndex = content.indexOf(startMarker, endIndex + endMarker.length);
    }
    return blocks;
}

// Authoritative corpus: markdown/ at the repo root (canvas, efforts,
// equipment, dashboards). tests/wods/ → repo root is four levels up.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const wodDir = join(repoRoot, 'markdown');
const mdFiles = findMarkdownFiles(wodDir);

describe('WOD Integration Tests', () => {
    for (const file of mdFiles) {
        const relativePath = relative(wodDir, file);
        const content = readFileSync(file, 'utf-8');
        const wods = extractScriptBlocks(content);

        if (wods.length === 0) continue;

        describe(`File: ${relativePath}`, () => {
            wods.forEach((wod, index) => {
                it(`WOD block #${index + 1}`, async () => {
                    const script = await TestScript.compile(wod);

                    try {
                        // 1. Verify "Ready to Start" is loaded (TestScript.compile already started the session)
                        const s0 = await script.snapshot();
                        expect(s0.depth, 'Stack should not be empty after compile').toBeGreaterThanOrEqual(1);

                        // 2. Try to end it as quickly as possible
                        let safetyValve = 0;
                        const maxSteps = 500;

                        while ((await script.snapshot()).depth > 0 && safetyValve < maxSteps) {
                            await script.tick(60 * 1000);
                            await script.next();
                            safetyValve++;
                        }

                        // 3. Verify stack is down to 0
                        const finalState = await script.snapshot();
                        if (finalState.depth > 0) {
                            const currentStack = finalState.blocks.map(b => b.label).join(' > ');
                            throw new Error(`Session failed to terminate after ${safetyValve} steps. Final stack: ${currentStack}`);
                        }
                        expect(finalState.depth).toBe(0);
                    } finally {
                        await script.dispose();
                    }
                });
            });
        });
    }
});
