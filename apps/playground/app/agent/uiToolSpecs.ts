import { z } from 'zod';
import {
  zodSchemaToJsonSchema,
  type AgentUiToolManifestEntry,
} from '@bitcobblers/wod-wiki-engine/agent';

export const uiGetViewContextSchema = z.object({
  includeSampleEntries: z
    .boolean()
    .optional()
    .describe('Include up to 50 unbatched stream entries when on a stream route (default true).'),
});

export const uiNavigateSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Internal app path (with optional ?query and #hash) to navigate to, e.g. "/journal", "/day/2026-11-11", "/note/<id>", "/notebooks", "/dashboards".',
    ),
  replace: z.boolean().optional().describe('Replace current history entry instead of pushing.'),
});

export const uiCastControlSchema = z.object({
  action: z
    .enum(['status', 'disconnect'])
    .describe('Inspect active Chromecast/receiver session status or disconnect an active session.'),
});

export const uiSetStreamQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .describe('WQL query string to apply to the mounted stream view (e.g. ":note{tags:benchmark}").'),
  layout: z
    .enum(['cards', 'rows', 'feed', 'agenda', 'planner'])
    .optional()
    .describe('Switch stream layout mode and sync ?layout= in URL.'),
  groupBy: z
    .string()
    .nullable()
    .optional()
    .describe('Grouping dimension (e.g. "date", "week", "notebook") or null to clear.'),
  resetToDefault: z
    .boolean()
    .optional()
    .describe('Undo custom stream filter and restore the route default WQL query.'),
});

export const uiEditorDraftSchema = z.object({
  operation: z
    .enum(['read', 'replace', 'append', 'undo'])
    .describe('Read live editor buffer, replace document content, append Markdown/workout block, or undo last edit.'),
  content: z
    .string()
    .optional()
    .describe('Markdown or Whiteboard Script content for replace / append operations.'),
  save: z
    .boolean()
    .optional()
    .describe('Flush and persist the draft to storage immediately after applying the edit (default false).'),
});

export const uiStartLiveWorkoutSchema = z.object({
  blockId: z
    .string()
    .optional()
    .describe('Optional workout block ID in the active Note editor (defaults to first ```time block).'),
  autoStart: z
    .boolean()
    .optional()
    .describe('Automatically start the timer after mounting the workout clock (default true).'),
});

export const uiClockControlSchema = z.object({
  command: z
    .enum([
      'next',
      'playback',
      'stop-request',
      'stop-confirm',
      'stop-cancel',
      'values-open',
      'entry-cancel',
      'entry-save',
      'entry-skip',
      'reps-adjust',
      'reps-set',
      'reps-select',
      'choice-select',
      'ready-start',
      'dismiss',
      'status',
    ])
    .describe('Live workout clock command to dispatch (or "status" to read current ClockSnapshot).'),
  fieldId: z.string().optional().describe('Target fieldId for entry-save, entry-skip, or choice-select.'),
  value: z.number().optional().describe('Numeric value for entry-save or reps-set.'),
  occurrenceId: z
    .string()
    .optional()
    .describe('Rep occurrenceId for reps-adjust, reps-set, or reps-select.'),
  delta: z
    .union([z.literal(1), z.literal(-1)])
    .optional()
    .describe('+1 or -1 delta for reps-adjust.'),
  index: z.number().int().min(0).optional().describe('Zero-based alternative index for choice-select.'),
});

export const uiPreferencesSchema = z.object({
  action: z
    .enum(['get', 'set'])
    .describe('Read current Playground UI preferences ("get") or update preferences ("set").'),
  theme: z
    .enum(['light', 'dark', 'system'])
    .optional()
    .describe('Color theme preference (`light`, `dark`, or `system`).'),
  audioEnabled: z
    .boolean()
    .optional()
    .describe('Enable or mute workout timer audio cues.'),
  debugMode: z
    .boolean()
    .optional()
    .describe('Enable or disable global runtime debug mode.'),
  analyticsUnit: z
    .enum(['kg', 'lb'])
    .optional()
    .describe('Preferred display unit for analytics charts (`kg` or `lb`).'),
  leftDrawerOpen: z
    .boolean()
    .optional()
    .describe('Open or close the primary navigation drawer on mobile/tablet.'),
  rightDrawerOpen: z
    .boolean()
    .optional()
    .describe('Open or close the secondary L3 context drawer on mobile/tablet.'),
});

export const uiSetExplorerQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .describe('WQL aggregate or find query string to set on the Metric Explorer (`/dashboards`), e.g. "sum:totalVolume{} by {week}".'),
  submit: z
    .boolean()
    .optional()
    .describe('Execute/submit the query immediately (default true when `query` is provided).'),
  weeks: z
    .union([z.literal(4), z.literal(8), z.literal(16)])
    .optional()
    .describe('Analytics lookback range in weeks (`4`, `8`, or `16`).'),
  openSaveDialog: z
    .boolean()
    .optional()
    .describe('Open the "Save to dashboard" dialog for the active query.'),
  openQuerySettings: z
    .boolean()
    .optional()
    .describe('Open the surface query settings dialog on `/dashboards`.'),
});

export function exportPlaygroundUiToolsManifest(): AgentUiToolManifestEntry[] {
  return [
    {
      name: 'ui_get_view_context',
      title: 'Get Active UI View Context',
      description:
        'Read the current browser route, hydration/loading state, unbatched stream results, active editor metadata, and live workout clock snapshot.',
      tier: 0,
      surfaces: ['webmcp'],
      mountScope: 'always (Playground shell)',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiGetViewContextSchema),
    },
    {
      name: 'ui_navigate',
      title: 'Navigate Playground Route',
      description:
        'Navigate the React Router SPA to any WOD Wiki route (`/journal`, `/day/:date`, `/note/:id`, `/notebooks`, `/dashboards`, `/run/:id?note=:noteId`) and wait for UI commit.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'always (Playground shell)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiNavigateSchema),
    },
    {
      name: 'ui_cast_control',
      title: 'Inspect or Disconnect Cast Session',
      description:
        'Check active Chromecast / receiver display session state or cleanly disconnect an active Cast session.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'always (Playground shell)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiCastControlSchema),
    },
    {
      name: 'ui_set_stream_query',
      title: 'Set Live Stream WQL Query or Layout',
      description:
        'Update the live WQL query, layout (`cards`, `rows`, `feed`, `agenda`, `planner`), or grouping on the currently mounted stream view, or reset to the route default.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'mounted stream routes (/journal, /notes, /notebooks, /sessions, /efforts, /tags, /feeds)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiSetStreamQuerySchema),
    },
    {
      name: 'ui_editor_draft',
      title: 'Read, Edit, or Undo Live Note Editor Buffer',
      description:
        'Inspect or edit the live CodeMirror 6 Note buffer (`read`, `replace`, `append`, `undo`) with full undo history and optional immediate persistence.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'mounted Note / Journal / Playground editor surfaces',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiEditorDraftSchema),
    },
    {
      name: 'ui_start_live_workout',
      title: 'Start Live Interactive Workout Timer',
      description:
        'Launch the live interactive workout clock on screen from a workout block in the active Note editor so the human athlete and agent can co-drive the session.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'mounted Note / Journal / Playground editor surfaces',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiStartLiveWorkoutSchema),
    },
    {
      name: 'ui_clock_control',
      title: 'Control Live Workout Clock',
      description:
        'Dispatch commands (`next`, `playback`, `ready-start`, `entry-save`, `reps-set`, `stop-request`, `stop-confirm`, `dismiss`, etc.) to the active on-screen workout clock and return the updated ClockSnapshot.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'mounted live workout timer (FullscreenTimer / RuntimeTimerPanel)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiClockControlSchema),
    },
    {
      name: 'ui_preferences',
      title: 'Get or Set Playground UI Preferences',
      description:
        'Read or update global Playground UI preferences (`theme`, `audioEnabled`, `debugMode`, `analyticsUnit`, and mobile navigation drawers).',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'always (Playground shell)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiPreferencesSchema),
    },
    {
      name: 'ui_set_explorer_query',
      title: 'Set or Run Analytics Explorer WQL Query',
      description:
        'Set or execute an aggregate or find WQL query on the Metric Explorer (`/dashboards`), change the week window (`4`, `8`, `16`), or open the Save-to-Dashboard / Query Settings dialogs.',
      tier: 1,
      surfaces: ['webmcp'],
      mountScope: 'mounted Metric Explorer route (/dashboards)',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: zodSchemaToJsonSchema(uiSetExplorerQuerySchema),
    },
  ];
}
