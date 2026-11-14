/**
 * Convert a recorded WOD Wiki browser workflow — either a collaborative flight
 * log (`window.__wodExportFlightLog()` from `e2e/scripts/install-flight-recorder.js`)
 * or a raw Playwright `codegen` / `playwright-cli` TypeScript recording — into:
 *
 *   1. A canonical Level-1 Markdown user journey (`e2e/specs/<domain>/<slug>.md`)
 *      conforming to `scripts/check-e2e-specs.ts` and `GLOSSARY.md` terms.
 *   2. A step-by-step `PlaygroundTestActor` + `TEST_IDS` compilation plan ready
 *      for the `wod-wiki-testing` Markdown -> Playwright pipeline.
 *
 * Usage:
 *   bun scripts/e2e-workflow-recorder.ts --from-flight /tmp/flight.json --title "Search palette navigation"
 *   bun scripts/e2e-workflow-recorder.ts --from-codegen /tmp/recorded.ts --out e2e/specs/journal/search-palette.md --print-actor-hints
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { TEST_IDS } from '../apps/playground/src/lib/testIds';

export type CanonicalE2eDomain =
  | 'journal'
  | 'notebooks'
  | 'runtime'
  | 'properties'
  | 'analytics'
  | 'feeds';

export type CanonicalPriority = 'P0-gate' | 'P1-core' | 'P1' | 'P2';
export type CanonicalViewport = 'desktop' | 'mobile-375' | 'cold-boot' | 'dark';

export interface FlightTargetDescriptor {
  testId?: string | null;
  tag?: string | null;
  role?: string | null;
  label?: string | null;
  href?: string | null;
  inputType?: string | null;
}

export interface FlightViewStateSnapshot {
  route?: {
    pathname?: string;
    search?: string;
    hash?: string;
  } | null;
  status?: string | null;
  feedReadiness?: string | null;
  stream?: {
    route?: string | null;
    query?: string | null;
    layout?: string | null;
    totalUnbatchedCount?: number | null;
  } | null;
  explorer?: {
    submitted?: string | null;
    weeks?: number | null;
  } | null;
  editor?: {
    noteId?: string | null;
    readonly?: boolean;
    workoutBlockIds?: string[];
  } | null;
  clock?: {
    isRunning?: boolean;
    primaryLabel?: string | null;
  } | null;
}

export interface RawFlightEvent {
  seq?: number;
  ts?: number;
  kind: 'navigate' | 'click' | 'fill' | 'editor' | 'shortcut' | 'webmcp' | 'expect' | 'step-note';
  actor?: 'human' | 'agent' | 'webmcp' | 'system' | 'collab';
  route?: string;
  path?: string;
  trigger?: string;
  viewport?: { width: number; height: number };
  theme?: 'light' | 'dark';
  target?: FlightTargetDescriptor | null;
  value?: string;
  noteId?: string | null;
  content?: string;
  key?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  text?: string;
  viewState?: FlightViewStateSnapshot | null;
}

export interface RawFlightLogEnvelope {
  version?: string;
  exportedAt?: string;
  origin?: string;
  viewport?: { width: number; height: number };
  theme?: 'light' | 'dark';
  finalViewState?: FlightViewStateSnapshot | null;
  events: RawFlightEvent[];
}

export interface ExtractedJourneyStep {
  actorLabel: 'Athlete' | 'Coach' | 'Agent';
  stepText: string;
  actorCallHint: string;
  routePattern?: string;
}

export interface JourneyExtractionOptions {
  id?: string;
  title?: string;
  slug?: string;
  domain?: CanonicalE2eDomain;
  priority?: CanonicalPriority;
  personas?: string[];
  scenarioTitle?: string;
  given?: string;
  summary?: string;
}

export interface ExtractedJourneyArtifact {
  id: string;
  title: string;
  slug: string;
  domain: CanonicalE2eDomain;
  priority: CanonicalPriority;
  routes: string[];
  personas: string[];
  viewports: CanonicalViewport[];
  specMdRelPath: string;
  specTsRelPath: string;
  markdown: string;
  steps: ExtractedJourneyStep[];
  expects: string[];
  actorPlanLines: string[];
}

const VALUE_TO_TEST_ID_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(TEST_IDS).map(([key, val]) => [val, key]),
);

const DOMAIN_PREFIX: Record<CanonicalE2eDomain, string> = {
  journal: 'JRN',
  notebooks: 'NTB',
  runtime: 'RUN',
  properties: 'PRP',
  analytics: 'ANL',
  feeds: 'FED',
};

const GLOSSARY_SYNONYM_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcollections\b/gi, 'Notebooks'],
  [/\bcollection\b/gi, 'Notebook'],
  [/\bworkout results\b/gi, 'Sessions'],
  [/\bworkout result\b/gi, 'Session'],
  [/\bexercise rows?\b/gi, 'Efforts'],
  [/\bapparatus records?\b/gi, 'Equipment'],
];

export function normalizeGlossaryTerms(input: string): string {
  let out = input;
  for (const [pattern, replacement] of GLOSSARY_SYNONYM_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function slugifyJourney(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'recorded-user-journey';
}

export function canonicalizeRoutePattern(rawPath: string): string {
  const pathname = (rawPath.split('?')[0] ?? '/').split('#')[0] || '/';
  if (/^\/day\/\d{4}-\d{2}-\d{2}$/.test(pathname)) return '/day/:date';
  if (/^\/session\/\d{4}-\d{2}-\d{2}$/.test(pathname)) return '/session/:date';
  if (/^\/load\/journal\/\d{4}-\d{2}-\d{2}$/.test(pathname)) return '/load/journal/:date';
  if (/^\/note\/[^/]+$/.test(pathname)) return '/note/:noteId';
  if (/^\/playground\/[^/]+$/.test(pathname)) return '/playground/:id';
  if (/^\/run\/[^/]+$/.test(pathname)) return '/run/:runtimeId';
  if (/^\/results\/[^/]+$/.test(pathname)) return '/results/:sessionId';
  if (/^\/effort\/[^/]+$/.test(pathname)) return '/effort/:slug';
  if (/^\/equipment\/[^/]+$/.test(pathname)) return '/equipment/:slug';
  if (/^\/dashboard\/[^/]+$/.test(pathname)) return '/dashboard/:slug';
  if (/^\/feed\/[^/]+$/.test(pathname)) return '/feed/:slug';
  if (/^\/page\/[^/]+$/.test(pathname)) return '/page/:slug';
  if (/^\/t\/[^/]+\/[^/]+$/.test(pathname)) return '/t/:type/:tag';
  if (/^\/t\/[^/]+$/.test(pathname)) return '/t/:type';
  if (/^\/notebook\/[^/]+\/\d{4}-\d{2}-\d{2}\/[^/]+$/.test(pathname)) {
    return '/notebook/:slug/:itemDate/:item';
  }
  if (/^\/notebook\/[^/]+\/[^/]+$/.test(pathname)) return '/notebook/:slug/:target';
  if (/^\/notebook\/[^/]+$/.test(pathname)) return '/notebook/:slug';
  return pathname;
}

export function inferDomainFromRoutes(routes: readonly string[]): CanonicalE2eDomain {
  for (const r of routes) {
    if (r.startsWith('/run')) return 'runtime';
    if (r.startsWith('/dashboard') || r.startsWith('/results') || r.startsWith('/sessions')) {
      return 'analytics';
    }
    if (r.startsWith('/feed') || r.startsWith('/subscribe') || r.startsWith('/load')) {
      return 'feeds';
    }
    if (
      r.startsWith('/effort') ||
      r.startsWith('/equipment') ||
      r.startsWith('/tags') ||
      r.startsWith('/t/')
    ) {
      return 'properties';
    }
    if (r.startsWith('/notebook')) return 'notebooks';
  }
  return 'journal';
}

function compactSingleLine(value: string, maxLen = 72): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
}

function actorSubject(actor?: RawFlightEvent['actor'], defaultPersona = 'Athlete'): 'Athlete' | 'Coach' | 'Agent' {
  if (actor === 'webmcp') return 'Agent';
  if (defaultPersona === 'Coach') return 'Coach';
  return 'Athlete';
}

function translateClickStep(
  event: RawFlightEvent,
  subject: 'Athlete' | 'Coach' | 'Agent',
): ExtractedJourneyStep | null {
  const t = event.target;
  if (!t) return null;
  const testId = t.testId ?? null;
  const constKey = testId ? VALUE_TO_TEST_ID_KEY.get(testId) : undefined;
  const label = t.label ? normalizeGlossaryTerms(t.label) : null;

  if (testId === TEST_IDS.EDITOR_START_WORKOUT) {
    return {
      actorLabel: subject,
      stepText: `${subject} clicks Start Workout on the active Note workout block.`,
      actorCallHint: 'await app.runtime.useFastClock(60);\nawait app.runtime.startWorkout();',
    };
  }
  if (testId === TEST_IDS.TIMER_NEXT_BLOCK || testId === TEST_IDS.TRACKER_NEXT_BUTTON) {
    return {
      actorLabel: subject,
      stepText: `${subject} advances the active Session to the next workout segment.`,
      actorCallHint: 'await app.runtime.advance(1);',
    };
  }
  if (testId === TEST_IDS.TIMER_PLAY_PAUSE) {
    return {
      actorLabel: subject,
      stepText: `${subject} toggles play/pause on the active Session clock.`,
      actorCallHint: 'await app.page.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE).click();',
    };
  }
  if (testId === TEST_IDS.TIMER_STOP_SESSION || testId === TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT) {
    return {
      actorLabel: subject,
      stepText: `${subject} stops and finalizes the active Session.`,
      actorCallHint: 'await app.runtime.stopSession();',
    };
  }
  if (testId === TEST_IDS.PUBLICATION_PILL) {
    return {
      actorLabel: subject,
      stepText: `${subject} opens the Publication Visibility & Notebook promotion popover.`,
      actorCallHint: 'await app.feeds.openPromotionPopover();',
    };
  }
  if (testId === TEST_IDS.COMMAND_PALETTE_TRIGGER || testId === TEST_IDS.NAV_L1_SEARCH) {
    return {
      actorLabel: subject,
      stepText: `${subject} opens the global WQL search command palette.`,
      actorCallHint: 'await app.page.getByTestId(TEST_IDS.COMMAND_PALETTE_TRIGGER).click();',
    };
  }
  if (testId === TEST_IDS.NOTEBOOKS_CREATE_BUTTON) {
    return {
      actorLabel: subject,
      stepText: `${subject} opens the Create Notebook dialog.`,
      actorCallHint: "await app.notebooks.create('<Name>', '<Description>');",
    };
  }
  if (testId === TEST_IDS.EFFORTS_CREATE_BTN) {
    return {
      actorLabel: subject,
      stepText: `${subject} opens the New Effort creation flow from the Efforts stream.`,
      actorCallHint: 'await app.page.getByTestId(TEST_IDS.EFFORTS_CREATE_BTN).click();',
    };
  }
  if (t.href && t.href.startsWith('/')) {
    return {
      actorLabel: subject,
      stepText: `${subject} selects '${label ?? t.href}' to open '${t.href}'.`,
      actorCallHint: `await app.goto('${t.href}');`,
      routePattern: canonicalizeRoutePattern(t.href),
    };
  }
  if (constKey) {
    return {
      actorLabel: subject,
      stepText: `${subject} activates ${label ? `'${label}'` : `'${testId}'`} (\`${testId}\`).`,
      actorCallHint: `await app.page.getByTestId(TEST_IDS.${constKey}).click();`,
    };
  }
  if (testId) {
    return {
      actorLabel: subject,
      stepText: `${subject} clicks ${label ? `'${label}'` : `'${testId}'`} (\`${testId}\`).`,
      actorCallHint: `await app.page.getByTestId('${testId}').click();`,
    };
  }
  if (label) {
    const role = t.role ?? (t.tag === 'button' ? 'button' : t.tag === 'a' ? 'link' : 'element');
    return {
      actorLabel: subject,
      stepText: `${subject} clicks the '${label}' ${role}.`,
      actorCallHint:
        role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem'
          ? `await app.page.getByRole('${role}', { name: ${JSON.stringify(label)} }).click();`
          : `await app.page.getByText(${JSON.stringify(label)}).click();`,
    };
  }
  return null;
}

function translateFillStep(
  event: RawFlightEvent,
  subject: 'Athlete' | 'Coach' | 'Agent',
): ExtractedJourneyStep | null {
  const t = event.target;
  const val = event.value ?? '';
  const testId = t?.testId ?? null;
  const constKey = testId ? VALUE_TO_TEST_ID_KEY.get(testId) : undefined;
  const label = t?.label ? normalizeGlossaryTerms(t.label) : 'input field';

  if (testId === TEST_IDS.STREAM_QUERY_BAR) {
    return {
      actorLabel: subject,
      stepText: `${subject} enters the WQL stream query '${val}'.`,
      actorCallHint: `await app.wql.fillStreamQueryBar(${JSON.stringify(val)});`,
    };
  }
  if (testId === TEST_IDS.COMMAND_PALETTE_INPUT) {
    return {
      actorLabel: subject,
      stepText: `${subject} types '${val}' into the global search palette.`,
      actorCallHint: `await app.page.getByTestId(TEST_IDS.COMMAND_PALETTE_INPUT).fill(${JSON.stringify(val)});`,
    };
  }
  if (constKey) {
    return {
      actorLabel: subject,
      stepText: `${subject} sets '${label}' to '${val}'.`,
      actorCallHint: `await app.page.getByTestId(TEST_IDS.${constKey}).fill(${JSON.stringify(val)});`,
    };
  }
  if (testId) {
    return {
      actorLabel: subject,
      stepText: `${subject} fills '${label}' (\`${testId}\`) with '${val}'.`,
      actorCallHint: `await app.page.getByTestId('${testId}').fill(${JSON.stringify(val)});`,
    };
  }
  return {
    actorLabel: subject,
    stepText: `${subject} enters '${val}' into '${label}'.`,
    actorCallHint: `await app.page.getByLabel(${JSON.stringify(label)}).fill(${JSON.stringify(val)});`,
  };
}

function translateWebMcpStep(event: RawFlightEvent): ExtractedJourneyStep {
  const tool = event.toolName ?? 'unknown';
  const args = event.toolArgs ?? {};
  if (tool === 'ui_navigate' && typeof args.path === 'string') {
    return {
      actorLabel: 'Agent',
      stepText: `Agent navigates the Playground to '${args.path}' via WebMCP \`ui_navigate\`.`,
      actorCallHint: `await app.goto(${JSON.stringify(args.path)});`,
      routePattern: canonicalizeRoutePattern(args.path),
    };
  }
  if (tool === 'ui_set_stream_query') {
    const q = typeof args.query === 'string' ? args.query : '';
    const layout = typeof args.layout === 'string' ? args.layout : '';
    return {
      actorLabel: 'Agent',
      stepText: `Agent updates the active stream view (${[q && `query '${q}'`, layout && `layout '${layout}'`].filter(Boolean).join(', ') || 'reset'}) via \`ui_set_stream_query\`.`,
      actorCallHint: q
        ? `await app.wql.fillStreamQueryBar(${JSON.stringify(q)});`
        : 'await app.goto(app.page.url());',
    };
  }
  if (tool === 'ui_editor_draft') {
    const op = typeof args.operation === 'string' ? args.operation : 'replace';
    const content = typeof args.content === 'string' ? args.content : '';
    return {
      actorLabel: 'Agent',
      stepText: `Agent updates the live Note editor (${op}${content ? `: '${compactSingleLine(content)}'` : ''}) via \`ui_editor_draft\`.`,
      actorCallHint: content
        ? `await app.editor.replaceDocument(${JSON.stringify(content)});`
        : 'await app.editor.readDocument();',
    };
  }
  if (tool === 'ui_start_live_workout') {
    return {
      actorLabel: 'Agent',
      stepText: 'Agent launches the live Session workout clock from the active Note.',
      actorCallHint: 'await app.runtime.useFastClock(60);\nawait app.runtime.startWorkout();',
    };
  }
  if (tool === 'ui_clock_control') {
    const cmd = typeof args.command === 'string' ? args.command : 'next';
    return {
      actorLabel: 'Agent',
      stepText: `Agent dispatches '${cmd}' to the active Session clock.`,
      actorCallHint:
        cmd === 'next'
          ? 'await app.runtime.advance(1);'
          : cmd === 'stop-confirm'
            ? 'await app.runtime.stopSession();'
            : `// WebMCP ui_clock_control: ${cmd}`,
    };
  }
  return {
    actorLabel: 'Agent',
    stepText: `Agent executes \`${tool}\` (${compactSingleLine(JSON.stringify(args))}).`,
    actorCallHint: `// Execute WebMCP / PlaygroundTestActor equivalent for ${tool}(${JSON.stringify(args)})`,
  };
}

/**
 * Streamline raw flight events: collapse consecutive edits on the same input or
 * CodeMirror buffer, collapse duplicate back-to-back route transitions, and
 * coalesceconsecutive identical advances.
 */
export function streamlineFlightEvents(rawEvents: readonly RawFlightEvent[]): RawFlightEvent[] {
  const out: RawFlightEvent[] = [];
  for (const event of rawEvents) {
    const prev = out[out.length - 1];
    if (event.kind === 'navigate') {
      const path = event.path ?? event.route ?? '/';
      if (path === 'blank' || path === 'about:blank' || !path.startsWith('/')) {
        continue;
      }
      if (prev?.kind === 'navigate' && (prev.path ?? prev.route) === path) {
        continue;
      }
      // Skip automatic router echo right after a link click to the exact same href
      if (prev?.kind === 'click' && prev.target?.href && prev.target.href === path) {
        continue;
      }
    }
    if (
      event.kind === 'fill' &&
      prev?.kind === 'fill' &&
      (prev.target?.testId ?? prev.target?.label) === (event.target?.testId ?? event.target?.label)
    ) {
      out[out.length - 1] = event;
      continue;
    }
    if (event.kind === 'editor' && prev?.kind === 'editor' && prev.noteId === event.noteId) {
      out[out.length - 1] = event;
      continue;
    }
    out.push(event);
  }
  return out;
}

/**
 * Parse a raw Playwright `codegen` or `playwright-cli` TypeScript file into
 * `RawFlightEvent` items so it flows through the exact same Markdown compiler.
 */
export function parsePlaywrightCodegenSource(source: string): RawFlightLogEnvelope {
  const events: RawFlightEvent[] = [];
  let viewport: { width: number; height: number } = { width: 1280, height: 800 };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('test(')) {
      continue;
    }

    const vpMatch = line.match(/setViewportSize\(\{\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)\s*\}\)/);
    if (vpMatch) {
      viewport = { width: Number(vpMatch[1]), height: Number(vpMatch[2]) };
      continue;
    }

    const gotoMatch = line.match(/\.goto\(\s*(['"`])([^'"`]+)\1/);
    if (gotoMatch) {
      const rawUrl = gotoMatch[2]!;
      const path = rawUrl.replace(/^https?:\/\/[^/]+/, '') || '/';
      events.push({ kind: 'navigate', actor: 'human', path, route: path, viewport });
      continue;
    }

    const testIdAction = line.match(
      /getByTestId\(\s*(?:TEST_IDS\.([A-Z0-9_]+)|(['"`])([^'"`]+)\2)\s*\)\.(click|fill|press)\(\s*(?:(['"`])([^'"`]*)\5)?/,
    );
    if (testIdAction) {
      const enumKey = testIdAction[1] as keyof typeof TEST_IDS | undefined;
      const testId = enumKey ? TEST_IDS[enumKey] : testIdAction[3]!;
      const action = testIdAction[4]!;
      const arg = testIdAction[6] ?? '';
      if (action === 'click') {
        events.push({ kind: 'click', actor: 'human', viewport, target: { testId } });
      } else if (action === 'fill') {
        events.push({
          kind: 'fill',
          actor: 'human',
          viewport,
          target: { testId, label: testId },
          value: arg,
        });
      } else if (action === 'press') {
        events.push({
          kind: 'shortcut',
          actor: 'human',
          viewport,
          key: arg,
          target: { testId },
        });
      }
      continue;
    }

    const roleAction = line.match(
      /getByRole\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{\s*name:\s*(['"`])([^'"`]+)\3[^}]*\})?\s*\)\.(click|fill|press)\(\s*(?:(['"`])([^'"`]*)\6)?/,
    );
    if (roleAction) {
      const role = roleAction[2]!;
      const name = roleAction[4] ?? role;
      const action = roleAction[5]!;
      const arg = roleAction[7] ?? '';
      if (action === 'click') {
        events.push({
          kind: 'click',
          actor: 'human',
          viewport,
          target: { role, label: name },
        });
      } else if (action === 'fill') {
        events.push({
          kind: 'fill',
          actor: 'human',
          viewport,
          target: { role, label: name },
          value: arg,
        });
      } else if (action === 'press') {
        events.push({
          kind: 'shortcut',
          actor: 'human',
          viewport,
          key: arg,
          target: { role, label: name },
        });
      }
      continue;
    }

    const placeholderFill = line.match(
      /getByPlaceholder\(\s*(['"`])([^'"`]+)\1\s*\)\.fill\(\s*(['"`])([^'"`]*)\3/,
    );
    if (placeholderFill) {
      events.push({
        kind: 'fill',
        actor: 'human',
        viewport,
        target: { label: placeholderFill[2]! },
        value: placeholderFill[4]!,
      });
      continue;
    }

    const keyboardPress = line.match(/keyboard\.press\(\s*(['"`])([^'"`]+)\1/);
    if (keyboardPress) {
      events.push({
        kind: 'shortcut',
        actor: 'human',
        viewport,
        key: keyboardPress[2]!,
      });
      continue;
    }

    const expectTextMatch = line.match(
      /expect\((.+?)\)\.(toContainText|toHaveText|toBeVisible|toHaveURL)\(\s*(?:(['"`/])(.+?)\3)?/,
    );
    if (expectTextMatch) {
      const matcher = expectTextMatch[2]!;
      const expectedArg = expectTextMatch[4] ?? '';
      const summary =
        matcher === 'toBeVisible'
          ? `target ${compactSingleLine(expectTextMatch[1]!)} is visible`
          : matcher === 'toHaveURL'
            ? `route matches '${expectedArg}'`
            : `surface displays '${expectedArg}'`;
      events.push({
        kind: 'expect',
        actor: 'collab',
        viewport,
        text: summary,
      });
    }
  }

  return {
    version: '1.0',
    viewport,
    events,
  };
}

export function extractJourneyFromFlightLog(
  envelopeInput: RawFlightLogEnvelope | readonly RawFlightEvent[],
  options: JourneyExtractionOptions = {},
): ExtractedJourneyArtifact {
  const envelope: RawFlightLogEnvelope = Array.isArray(envelopeInput)
    ? { events: [...envelopeInput] }
    : (envelopeInput as RawFlightLogEnvelope);

  const streamlined = streamlineFlightEvents(envelope.events ?? []);
  const seenRoutes = new Set<string>();
  const seenViewports = new Set<CanonicalViewport>(['desktop']);
  let hasWebMcp = false;

  if (envelope.viewport && envelope.viewport.width <= 480) {
    seenViewports.add('mobile-375');
  }
  if (envelope.theme === 'dark') {
    seenViewports.add('dark');
  }

  const defaultPersona = options.personas?.[0] ?? 'Athlete';
  const steps: ExtractedJourneyStep[] = [];
  const expects: string[] = [];

  for (const event of streamlined) {
    if (event.viewport && event.viewport.width <= 480) {
      seenViewports.add('mobile-375');
    }
    if (event.theme === 'dark') {
      seenViewports.add('dark');
    }
    if (event.route && event.route.startsWith('/')) {
      seenRoutes.add(canonicalizeRoutePattern(event.route));
    }

    const subject = actorSubject(event.actor, defaultPersona);

    if (event.kind === 'navigate') {
      const targetPath = event.path ?? event.route ?? '/';
      const pattern = canonicalizeRoutePattern(targetPath);
      seenRoutes.add(pattern);
      // Skip automatic router transitions right after startWorkout / stopSession clicks
      if (event.trigger === 'router' && steps.length > 0) {
        continue;
      }
      const actorHint = targetPath.startsWith('/day/')
        ? `await app.journal.openDate(${JSON.stringify(targetPath.slice('/day/'.length))});`
        : targetPath === '/journal'
          ? 'await app.journal.openStream();'
          : targetPath === '/notebooks'
            ? 'await app.notebooks.openLibrary();'
            : targetPath === '/dashboards'
              ? 'await app.wql.openExplorer();'
              : targetPath === '/feeds'
                ? 'await app.feeds.openFeeds();'
                : `await app.goto(${JSON.stringify(targetPath)});`;
      steps.push({
        actorLabel: defaultPersona === 'Coach' ? 'Coach' : 'Athlete',
        stepText: `${defaultPersona === 'Coach' ? 'Coach' : 'Athlete'} opens '${targetPath}'.`,
        actorCallHint: actorHint,
        routePattern: pattern,
      });
      continue;
    }

    if (event.kind === 'click') {
      const translated = translateClickStep(event, subject);
      if (translated) {
        if (translated.routePattern) seenRoutes.add(translated.routePattern);
        steps.push(translated);
      }
      continue;
    }

    if (event.kind === 'fill') {
      const translated = translateFillStep(event, subject);
      if (translated) steps.push(translated);
      continue;
    }

    if (event.kind === 'editor') {
      const content = event.content ?? '';
      const preview = compactSingleLine(content);
      steps.push({
        actorLabel: subject,
        stepText: `${subject} authors Note content '${preview}' in the editor.`,
        actorCallHint: content.includes('\n')
          ? `await app.editor.replaceDocument(${JSON.stringify(content)});`
          : `await app.editor.typeLine(${JSON.stringify(content)});`,
      });
      continue;
    }

    if (event.kind === 'shortcut') {
      const key = event.key ?? 'Enter';
      if (key === 'ControlOrMeta+/' || key === 'Control+/' || key === 'Meta+/') {
        steps.push({
          actorLabel: subject,
          stepText: `${subject} presses 'ControlOrMeta+/' to open the global WQL search palette.`,
          actorCallHint: "await app.page.keyboard.press('ControlOrMeta+/');",
        });
      } else {
        steps.push({
          actorLabel: subject,
          stepText: `${subject} presses '${key}'.`,
          actorCallHint: `await app.page.keyboard.press(${JSON.stringify(key)});`,
        });
      }
      continue;
    }

    if (event.kind === 'webmcp') {
      hasWebMcp = true;
      const step = translateWebMcpStep(event);
      if (step.routePattern) seenRoutes.add(step.routePattern);
      steps.push(step);
      continue;
    }

    if (event.kind === 'step-note' && event.text) {
      steps.push({
        actorLabel: subject,
        stepText: normalizeGlossaryTerms(event.text),
        actorCallHint: `// Collaborative step note: ${event.text}`,
      });
      continue;
    }

    if (event.kind === 'expect' && event.text) {
      expects.push(normalizeGlossaryTerms(event.text));
    }
  }

  if (steps.length === 0) {
    steps.push({
      actorLabel: 'Athlete',
      stepText: "Athlete opens '/journal'.",
      actorCallHint: 'await app.journal.openStream();',
      routePattern: '/journal',
    });
    seenRoutes.add('/journal');
  }

  const finalVs =
    envelope.finalViewState ??
    streamlined[streamlined.length - 1]?.viewState ??
    null;

  if (finalVs?.route?.pathname) {
    const finalRoute = `${finalVs.route.pathname}${finalVs.route.search ?? ''}`;
    seenRoutes.add(canonicalizeRoutePattern(finalVs.route.pathname));
    expects.push(`the active route settles at '${finalRoute}' with data-agent-status='ready'.`);
  }
  if (finalVs?.stream?.query) {
    expects.push(
      `the stream WQL query '${finalVs.stream.query}' is applied${typeof finalVs.stream.totalUnbatchedCount === 'number' ? ` (${finalVs.stream.totalUnbatchedCount} matching item(s))` : ''}.`,
    );
  }
  if (finalVs?.explorer?.submitted) {
    expects.push(
      `the Dashboard explorer renders aggregate results for '${finalVs.explorer.submitted}'.`,
    );
  }
  expects.push('the browser console and pageerror stream stay clean.');

  const dedupedExpects = [...new Set(expects)];
  const routes = [...seenRoutes];
  if (routes.length === 0) routes.push('/journal');

  const domain = options.domain ?? inferDomainFromRoutes(routes);
  const title = normalizeGlossaryTerms(options.title ?? 'Recorded workflow journey');
  const slug = options.slug ?? slugifyJourney(title);
  const id = options.id ?? `${DOMAIN_PREFIX[domain]}-REC`;
  const priority = options.priority ?? 'P1';
  const personas = options.personas
    ? [...options.personas]
    : hasWebMcp
      ? ['Athlete', 'Agent']
      : ['Athlete'];
  const viewports = [...seenViewports];

  const specMdRelPath = `e2e/specs/${domain}/${slug}.md`;
  const specTsRelPath = `e2e/live-app/${slug}.e2e.ts`;
  const scenarioTitle = normalizeGlossaryTerms(options.scenarioTitle ?? title);
  const given = normalizeGlossaryTerms(
    options.given ??
      'an athlete starting from the seeded core WOD Wiki workspace with deterministic DomainWorld fixtures',
  );
  const summary = normalizeGlossaryTerms(
    options.summary ??
      `Verifies the ${title.toLowerCase()} workflow across ${routes.join(', ')} using deterministic DomainWorld state and PlaygroundTestActor primitives.`,
  );

  const stepLines = steps.map((s, idx) => `${idx + 1}. ${s.stepText}`).join('\n');
  const expectLines = dedupedExpects.map((e) => `- expect: ${e}`).join('\n');

  const markdown = [
    '---',
    `domain: ${domain}`,
    `specFile: ${specTsRelPath}`,
    `routes: [${routes.join(', ')}]`,
    `personas: [${personas.join(', ')}]`,
    `viewports: [${viewports.join(', ')}]`,
    `priority: ${priority}`,
    '---',
    '',
    `# ${id} — ${title}`,
    '',
    summary,
    '',
    `### Scenario 1: ${scenarioTitle}`,
    '',
    `Given ${given.replace(/:$/, '')}:`,
    stepLines,
    expectLines,
    '',
  ].join('\n');

  const actorPlanLines: string[] = [
    `// spec: ${specMdRelPath}`,
    "import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';",
    '',
    `test.describe(${JSON.stringify(`${id} — ${title}`)}, () => {`,
    `  test(${JSON.stringify(`Scenario 1: ${scenarioTitle}`)}, async ({ app }) => {`,
    '    // Given: seed isolated DomainWorld via @bitcobblers/wod-wiki-core/testing (far-future dates 2099-*)',
    '    // await app.seed.world({ notes: [...] });',
    '',
    ...steps.flatMap((s, idx) => [
      `    // ${idx + 1}. ${s.stepText}`,
      ...s.actorCallHint.split('\n').map((line) => `    ${line}`),
    ]),
    '',
    ...dedupedExpects.map((e) => `    // expect: ${e}`),
    '    app.assertCleanConsole();',
    '  });',
    '});',
  ];

  return {
    id,
    title,
    slug,
    domain,
    priority,
    routes,
    personas,
    viewports,
    specMdRelPath,
    specTsRelPath,
    markdown,
    steps,
    expects: dedupedExpects,
    actorPlanLines,
  };
}

interface CliFlags {
  fromFlight?: string;
  fromCodegen?: string;
  out?: string;
  id?: string;
  title?: string;
  slug?: string;
  domain?: CanonicalE2eDomain;
  priority?: CanonicalPriority;
  persona?: string;
  scenario?: string;
  given?: string;
  printActorHints: boolean;
  json: boolean;
}

function parseCliArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    printActorHints: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '--from-flight' && next) {
      flags.fromFlight = next;
      i++;
    } else if (arg === '--from-codegen' && next) {
      flags.fromCodegen = next;
      i++;
    } else if (arg === '--out' && next) {
      flags.out = next;
      i++;
    } else if (arg === '--id' && next) {
      flags.id = next;
      i++;
    } else if (arg === '--title' && next) {
      flags.title = next;
      i++;
    } else if (arg === '--slug' && next) {
      flags.slug = next;
      i++;
    } else if (arg === '--domain' && next) {
      flags.domain = next as CanonicalE2eDomain;
      i++;
    } else if (arg === '--priority' && next) {
      flags.priority = next as CanonicalPriority;
      i++;
    } else if (arg === '--persona' && next) {
      flags.persona = next;
      i++;
    } else if (arg === '--scenario' && next) {
      flags.scenario = next;
      i++;
    } else if (arg === '--given' && next) {
      flags.given = next;
      i++;
    } else if (arg === '--print-actor-hints') {
      flags.printActorHints = true;
    } else if (arg === '--json') {
      flags.json = true;
    }
  }
  return flags;
}

function parseFlightJsonFile(filePath: string): RawFlightLogEnvelope {
  const raw = readFileSync(resolve(filePath), 'utf8').trim();
  let parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }
  return parsed as RawFlightLogEnvelope;
}

if (import.meta.main) {
  const flags = parseCliArgs(process.argv.slice(2));
  if (!flags.fromFlight && !flags.fromCodegen) {
    console.error(
      'Usage: bun scripts/e2e-workflow-recorder.ts (--from-flight <flight.json> | --from-codegen <recorded.ts>) [--title "..."] [--domain <domain>] [--out e2e/specs/<domain>/<slug>.md] [--print-actor-hints] [--json]',
    );
    process.exit(1);
  }

  const envelope: RawFlightLogEnvelope = flags.fromFlight
    ? parseFlightJsonFile(flags.fromFlight)
    : parsePlaywrightCodegenSource(readFileSync(resolve(flags.fromCodegen!), 'utf8'));

  let derivedSlug = flags.slug;
  let derivedDomain = flags.domain;
  if (flags.out) {
    const outClean = flags.out.replace(/\\/g, '/');
    if (!derivedSlug && outClean.endsWith('.md')) {
      derivedSlug = basename(outClean, '.md');
    }
    const domainMatch = outClean.match(/e2e\/specs\/([a-z]+)\//);
    if (!derivedDomain && domainMatch) {
      derivedDomain = domainMatch[1] as CanonicalE2eDomain;
    }
  }

  const artifact = extractJourneyFromFlightLog(envelope, {
    id: flags.id,
    title: flags.title,
    slug: derivedSlug,
    domain: derivedDomain,
    priority: flags.priority,
    personas: flags.persona ? [flags.persona] : undefined,
    scenarioTitle: flags.scenario,
    given: flags.given,
  });

  if (flags.out) {
    const absOut = resolve(flags.out);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, artifact.markdown, 'utf8');
    console.error(`[e2e-workflow-recorder] Wrote Level-1 Markdown spec -> ${flags.out}`);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } else {
    if (!flags.out) {
      process.stdout.write(artifact.markdown);
    }
    if (flags.printActorHints) {
      process.stdout.write(`\n/* --- PlaygroundTestActor Compilation Skeleton (${artifact.specTsRelPath}) --- */\n`);
      process.stdout.write(`${artifact.actorPlanLines.join('\n')}\n`);
    }
  }
}
