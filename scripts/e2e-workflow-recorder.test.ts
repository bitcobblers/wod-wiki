import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_IDS } from '../apps/playground/src/lib/testIds';
import { validateE2eSpecCrosswalk } from './check-e2e-specs';
import {
  canonicalizeRoutePattern,
  extractJourneyFromFlightLog,
  normalizeGlossaryTerms,
  parsePlaywrightCodegenSource,
  streamlineFlightEvents,
  type RawFlightLogEnvelope,
} from './e2e-workflow-recorder';

describe('e2e-workflow-recorder', () => {
  test('streamlines redundant navigations, consecutive fills, and CodeMirror edits', () => {
    const streamlined = streamlineFlightEvents([
      { kind: 'navigate', path: '/journal' },
      { kind: 'navigate', path: '/journal' },
      { kind: 'fill', target: { testId: TEST_IDS.STREAM_QUERY_BAR }, value: ':note{' },
      {
        kind: 'fill',
        target: { testId: TEST_IDS.STREAM_QUERY_BAR },
        value: ':note{tags:benchmark}',
      },
      { kind: 'editor', noteId: 'note-1', content: '# Draft' },
      { kind: 'editor', noteId: 'note-1', content: '# Draft\n\n```time\n10 Burpees\n```' },
    ]);

    expect(streamlined).toHaveLength(3);
    expect(streamlined[1]?.value).toBe(':note{tags:benchmark}');
    expect(streamlined[2]?.content).toContain('10 Burpees');
  });

  test('normalizes forbidden GLOSSARY.md synonyms into canonical domain terms', () => {
    expect(
      normalizeGlossaryTerms(
        'Promote workout result from collection into exercise row and apparatus record',
      ),
    ).toBe('Promote Session from Notebook into Efforts and Equipment');
    expect(canonicalizeRoutePattern('/day/2099-07-04?autoStart=b1')).toBe('/day/:date');
    expect(canonicalizeRoutePattern('/notebook/coach-program/2099-07-04/fran')).toBe(
      '/notebook/:slug/:itemDate/:item',
    );
  });

  test('extracts a collaborative human + agent + WebMCP flight log into a spec-lint-valid Markdown journey', () => {
    const flight: RawFlightLogEnvelope = {
      version: '1.0',
      viewport: { width: 375, height: 812 },
      theme: 'dark',
      finalViewState: {
        route: { pathname: '/results/sess-99', search: '' },
        status: 'ready',
      },
      events: [
        {
          kind: 'navigate',
          actor: 'human',
          path: '/day/2099-08-01',
          viewport: { width: 375, height: 812 },
        },
        {
          kind: 'editor',
          actor: 'human',
          noteId: 'day-2099-08-01',
          content: '# Collaborative WOD\n\n```time\n2 Rounds\n  10 Push-ups\n```',
        },
        {
          kind: 'webmcp',
          actor: 'webmcp',
          toolName: 'ui_start_live_workout',
          toolArgs: { autoStart: true },
        },
        {
          kind: 'click',
          actor: 'agent',
          target: { testId: TEST_IDS.TIMER_NEXT_BLOCK, label: 'Next' },
        },
        {
          kind: 'click',
          actor: 'human',
          target: { testId: TEST_IDS.TIMER_STOP_SESSION, label: 'Stop' },
        },
        {
          kind: 'expect',
          actor: 'collab',
          text: 'the completed workout result summary displays 2 rounds',
        },
      ],
    };

    const artifact = extractJourneyFromFlightLog(flight, {
      id: 'RUN-09',
      title: 'Collaborative day workout run',
      domain: 'runtime',
      priority: 'P1-core',
    });

    expect(artifact.personas).toEqual(['Athlete', 'Agent']);
    expect(artifact.viewports).toEqual(['desktop', 'mobile-375', 'dark']);
    expect(artifact.routes).toContain('/day/:date');
    expect(artifact.routes).toContain('/results/:sessionId');
    expect(artifact.markdown).toContain('# RUN-09 — Collaborative day workout run');
    // Forbidden 'workout result' normalized to 'Session'
    expect(artifact.markdown).toContain('- expect: the completed Session summary displays 2 rounds');
    expect(artifact.actorPlanLines.join('\n')).toContain('await app.runtime.useFastClock(60);');
    expect(artifact.actorPlanLines.join('\n')).toContain('await app.runtime.startWorkout();');
    expect(artifact.actorPlanLines.join('\n')).toContain('await app.runtime.advance(1);');
    expect(artifact.actorPlanLines.join('\n')).toContain('await app.runtime.stopSession();');

    // Verify 1:1 compliance with check-e2e-specs.ts crosswalk validator
    const tmpRepo = mkdtempSync(join(tmpdir(), 'wod-rec-spec-'));
    try {
      const mdPath = join(tmpRepo, artifact.specMdRelPath);
      const tsPath = join(tmpRepo, artifact.specTsRelPath);
      mkdirSync(join(tmpRepo, 'e2e/specs/runtime'), { recursive: true });
      mkdirSync(join(tmpRepo, 'e2e/live-app'), { recursive: true });
      writeFileSync(mdPath, artifact.markdown, 'utf8');
      writeFileSync(tsPath, `${artifact.actorPlanLines.join('\n')}\n`, 'utf8');

      const issues = validateE2eSpecCrosswalk(tmpRepo, { legacyUnpairedFiles: new Set() });
      expect(issues).toEqual([]);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  test('parses raw Playwright codegen TypeScript into canonical Markdown steps and actor hints', () => {
    const codegenTs = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:4173/efforts');
  await page.getByTestId('stream-query-bar').fill(':effort{origin:user}');
  await page.keyboard.press('Control+/');
  await page.getByTestId('command-palette-input').fill('kettlebell');
  await expect(page.getByTestId('command-palette-results')).toContainText('Kettlebell Swing');
});
`;
    const envelope = parsePlaywrightCodegenSource(codegenTs);
    const artifact = extractJourneyFromFlightLog(envelope, {
      id: 'PRP-09',
      title: 'Efforts stream filter and search palette lookup',
    });

    expect(artifact.domain).toBe('properties');
    expect(artifact.markdown).toContain("1. Athlete opens '/efforts'.");
    expect(artifact.markdown).toContain(
      "2. Athlete enters the WQL stream query ':effort{origin:user}'.",
    );
    expect(artifact.markdown).toContain(
      "3. Athlete presses 'ControlOrMeta+/' to open the global WQL search palette.",
    );
    expect(artifact.markdown).toContain(
      "4. Athlete types 'kettlebell' into the global search palette.",
    );
    expect(artifact.markdown).toContain("- expect: surface displays 'Kettlebell Swing'");
    expect(artifact.actorPlanLines.join('\n')).toContain(
      'await app.wql.fillStreamQueryBar(":effort{origin:user}");',
    );
    expect(artifact.actorPlanLines.join('\n')).toContain(
      'await app.page.getByTestId(TEST_IDS.COMMAND_PALETTE_INPUT).fill("kettlebell");',
    );
  });
});
