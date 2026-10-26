import type { PaletteDataSource, PaletteItem } from '@/components/organisms/command-palette/palette-types';

/** A single construct that users can look up from the command palette or home grid. */
export interface ConstructItem {
  id: string;
  label: string;
  /** Searchable tokens (lower-cased during search). */
  terms: string[];
  /** Palette selection navigates here. */
  route: string;
  /** Shown as the result sub-label so users know where they are landing. */
  sublabel: string;
  /** Home Quick Reference grid links here. */
  gridRoute: string;
}

/** Static registry of whiteboard constructs and their reference destinations.
 *
 * Palette routes and grid deep-links land on the consolidated guide
 * (markdown/canvas/guide/**): protocols/structure for timers and rounds,
 * metrics for capture and planned-vs-recorded, start#reference for the
 * one-table syntax reference.
 */
export const CONSTRUCT_REGISTRY: ConstructItem[] = [
  {
    id: 'amrap',
    label: 'AMRAP',
    terms: ['amrap'],
    route: '/page/guide-protocols',
    sublabel: 'Timer behaviors',
    gridRoute: '/page/guide-protocols?h=amrap',
  },
  {
    id: 'emom',
    label: 'EMOM',
    terms: ['emom'],
    route: '/page/guide-protocols',
    sublabel: 'Timer behaviors',
    gridRoute: '/page/guide-protocols?h=emom',
  },
  {
    id: 'tabata',
    label: 'Tabata',
    terms: ['tabata'],
    route: '/page/guide-protocols',
    sublabel: 'Timer behaviors',
    gridRoute: '/page/guide-protocols?h=tabata-intervals',
  },
  {
    id: 'rest',
    label: 'Rest',
    terms: ['rest', ':*'],
    route: '/page/guide-protocols',
    sublabel: 'Timer behaviors',
    gridRoute: '/page/guide-protocols?h=required-rest',
  },
  {
    id: 'duration',
    label: 'Duration',
    terms: ['duration', '5:00'],
    route: '/page/guide-protocols',
    sublabel: 'Timer behaviors',
    gridRoute: '/page/guide-protocols?h=countdown-countup',
  },
  {
    id: 'ladder',
    label: 'Ladder',
    terms: ['ladder', '21-15-9'],
    route: '/page/guide-structure',
    sublabel: 'Rounds & structure',
    gridRoute: '/page/guide-structure?h=rep-schemes',
  },
  {
    id: 'rounds',
    label: 'Rounds',
    terms: ['rounds'],
    route: '/page/guide-structure?h=rounds',
    sublabel: 'Rounds & structure',
    gridRoute: '/page/guide-structure?h=rounds',
  },
  {
    id: 'supersets',
    label: 'Supersets',
    terms: ['supersets'],
    route: '/page/guide-structure?h=nesting',
    sublabel: 'Rounds & structure',
    gridRoute: '/page/guide-structure?h=nesting',
  },
  {
    id: 'actual',
    label: 'Actual result',
    terms: ['actual', ':?'],
    route: '/page/guide-metrics',
    sublabel: 'Capture & feedback',
    gridRoute: '/page/guide-metrics?h=capture',
  },
  {
    id: 'load-prompt',
    label: 'Load prompt',
    terms: ['load prompt', '?lb', '225lb', 'load'],
    route: '/page/guide-metrics',
    sublabel: 'Capture & feedback',
    gridRoute: '/page/guide-metrics?h=capture',
  },
  {
    id: 'metrics',
    label: 'Metrics',
    terms: ['metrics', 'reps', 'effort', 'discipline'],
    route: '/page/guide-metrics?h=planned-vs-recorded',
    sublabel: 'Planned vs recorded',
    gridRoute: '/page/guide-metrics?h=planned-vs-recorded',
  },
  {
    id: 'palette',
    label: 'Command palette',
    terms: ['palette', '⌘/'],
    route: '/page/guide-start?h=reference',
    sublabel: 'Syntax reference',
    gridRoute: '/page/guide-start?h=reference',
  },
];

/** Maps each home-grid cell text to its construct registry entry id. */
export const CONSTRUCT_GRID_MAP: Record<string, string> = {
  '5:00 duration': 'duration',
  '(21-15-9) ladder': 'ladder',
  '225lb load': 'load-prompt',
  'AMRAP': 'amrap',
  'EMOM': 'emom',
  'Tabata': 'tabata',
  ':* rest': 'rest',
  ':? actual': 'actual',
  '?lb prompt': 'load-prompt',
  '⌘/ palette': 'palette',
  'rounds': 'rounds',
  'reps': 'metrics',
  'load': 'metrics',
  'effort': 'metrics',
  'discipline': 'metrics',
};

export const CONSTRUCT_GRID_CELLS = Object.keys(CONSTRUCT_GRID_MAP);

const registryById: Record<string, ConstructItem | undefined> = Object.fromEntries(
  CONSTRUCT_REGISTRY.map((item) => [item.id, item]),
);

/** Resolve a grid cell to its registry item. */
export function getConstructByGridCell(cell: string): ConstructItem | undefined {
  const id = CONSTRUCT_GRID_MAP[cell];
  return id ? registryById[id] : undefined;
}

/** Palette data source backed by the static construct registry. */
export function constructSource(): PaletteDataSource {
  return {
    id: 'constructs',
    label: 'Reference',
    search: (query) => {
      const low = query.toLowerCase().trim();
      if (!low) return [];

      const matches = CONSTRUCT_REGISTRY.filter((item) => {
        const label = item.label.toLowerCase();
        if (label.includes(low) || low.includes(label)) return true;
        return item.terms.some((term) => {
          const t = term.toLowerCase();
          return t.includes(low) || low.includes(t);
        });
      });

      return matches.map(
        (item): PaletteItem => ({
          id: `construct:${item.id}`,
          label: item.label,
          sublabel: item.sublabel,
          category: 'Reference',
          type: 'route',
          payload: { route: item.route },
        }),
      );
    },
  };
}
