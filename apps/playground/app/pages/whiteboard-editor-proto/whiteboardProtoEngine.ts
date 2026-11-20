import type { Text } from '@codemirror/state';

export type Dialect = 'time' | 'log' | 'query';
export type TimerMode = 'countdown' | 'rest' | 'countup' | 'collectible';

export type TokenKind =
  | 'duration'
  | 'scheme'
  | 'rounds'
  | 'rep'
  | 'effort'
  | 'equipment'
  | 'resistance'
  | 'distance'
  | 'action'
  | 'property'
  | 'tag'
  | 'unresolved'
  | 'lintError'
  | 'comment';

export interface EffortDef {
  id: string;
  name: string;
  aliases: string[];
  defaultEquipment: string | null;
  notebooks: string[];
  recent: boolean;
  category: string;
}

export interface EquipmentDef {
  id: string;
  name: string;
  desc: string;
}

export interface TagDef {
  slug: string;
  group: string;
  desc: string;
}

export interface WikiNoteDef {
  slug: string;
  title: string;
  tags: string[];
  summary: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  desc: string;
  lines: string[];
}

export interface CatalogStore {
  efforts: EffortDef[];
  equipment: EquipmentDef[];
  tags: TagDef[];
  wikiNotes: WikiNoteDef[];
}

export interface TokenMeta {
  mode?: TimerMode;
  mins?: number;
  secs?: number;
  sets?: number;
  reps?: number;
  inner?: string;
  keyword?: string;
  hasAt?: boolean;
  amount?: string | number;
  altAmount?: number | null;
  unit?: string;
  slug?: string;
  isTag?: boolean;
  tagInfo?: TagDef | null;
  effortId?: string;
  effortName?: string;
  equipment?: string | null;
  equipmentId?: string;
  equipmentName?: string;
  rawName?: string;
  key?: string;
  val?: string;
  lap?: boolean;
  separator?: boolean;
  isHeading?: boolean;
  message?: string;
  fixes?: string[];
}

export interface ParsedToken {
  id: string;
  kind: TokenKind;
  raw: string;
  /** 0-based start offset inside the line text */
  from: number;
  /** 0-based end offset inside the line text */
  to: number;
  meta: TokenMeta;
}

export interface LintIssue {
  token: ParsedToken;
  message: string;
  fixes: string[];
}

export interface ParsedWodLine {
  lineNum: number;
  text: string;
  tokens: ParsedToken[];
  errors: LintIssue[];
}

export interface BlockTimelineItem {
  lineNum: number;
  raw: string;
  seconds: number;
  isRest: boolean;
  hasError: boolean;
  label: string;
}

export interface BlockSummary {
  nonEmptyLines: number;
  totalSeconds: number;
  durLabel: string;
  roundsCount: number;
  errCount: number;
  unresolvedCount: number;
  timeline: BlockTimelineItem[];
}

export interface DocBlock {
  blockIdx: number;
  dialect: Dialect;
  sport: string;
  fenceStartLine: number;
  fenceEndLine: number;
  contentStartLine: number;
  contentEndLine: number;
  lines: ParsedWodLine[];
  summary: BlockSummary;
}

export interface NoteEntities {
  tags: string[];
  efforts: Array<{ id: string; name: string }>;
  equipment: Array<{ id: string; name: string }>;
  unresolved: Array<{
    raw: string;
    isTag: boolean;
    blockIdx: number;
    lineNum: number;
    token: ParsedToken;
  }>;
  errors: Array<{
    raw: string;
    message: string;
    fixes: string[];
    blockIdx: number;
    lineNum: number;
    token: ParsedToken;
  }>;
}

export interface DocAnalysis {
  title: string;
  frontmatter: {
    notebook: string;
    tags: string[];
    startLine: number | null;
    endLine: number | null;
    tagsLine: number | null;
  };
  blocks: DocBlock[];
  entities: NoteEntities;
  wodLineMap: Map<number, { blockIdx: number; parsed: ParsedWodLine }>;
  fenceLineMap: Map<number, { blockIdx: number; role: 'open' | 'close' }>;
  proseLineSet: Set<number>;
}

export interface ScenarioPreset {
  id: 'emom' | 'empty' | 'lint' | 'prose';
  label: string;
  doc: string;
  focusTarget: 'first-wod' | 'first-prose';
}

export const BASE_EFFORTS: EffortDef[] = [
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', aliases: ['kb swing', 'russian swing', 'swing'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'conditioning'], recent: true, category: 'Ballistic' },
  { id: 'back-squat', name: 'Back Squat', aliases: ['squat', 'bs'], defaultEquipment: 'Barbell', notebooks: ['strength', 'kettlebell'], recent: true, category: 'Squat' },
  { id: 'pull-up', name: 'Pull-up', aliases: ['pullup', 'strict pull-up', 'kipping pull-up'], defaultEquipment: 'Pull-Up Bar', notebooks: ['gymnastics', 'conditioning'], recent: true, category: 'Gymnastics' },
  { id: 'thruster', name: 'Thruster', aliases: ['bb thruster', 'barbell thruster'], defaultEquipment: 'Barbell', notebooks: ['conditioning', 'benchmarks'], recent: true, category: 'Barbell' },
  { id: 'run', name: 'Run', aliases: ['jog', 'sprint', 'shuttle'], defaultEquipment: null, notebooks: ['conditioning', 'endurance'], recent: true, category: 'Monostructural' },
  { id: 'plank', name: 'Plank', aliases: ['forearm plank', 'hollow plank'], defaultEquipment: null, notebooks: ['core', 'conditioning'], recent: true, category: 'Core' },
  { id: 'row', name: 'Row', aliases: ['erg', 'rower', 'concept2'], defaultEquipment: 'Rower', notebooks: ['conditioning', 'endurance'], recent: false, category: 'Monostructural' },
  { id: 'air-bike', name: 'Air Bike', aliases: ['assault bike', 'echo bike', 'bike'], defaultEquipment: 'Assault Bike', notebooks: ['conditioning'], recent: false, category: 'Monostructural' },
  { id: 'box-jump', name: 'Box Jump', aliases: ['bj', 'step up'], defaultEquipment: 'Box', notebooks: ['conditioning'], recent: false, category: 'Plyometric' },
  { id: 'deadlift', name: 'Deadlift', aliases: ['dl', 'conventional deadlift'], defaultEquipment: 'Barbell', notebooks: ['strength'], recent: false, category: 'Hinge' },
  { id: 'clean-and-jerk', name: 'Clean & Jerk', aliases: ['c&j', 'clean jerk'], defaultEquipment: 'Barbell', notebooks: ['strength', 'olympic'], recent: false, category: 'Olympic' },
  { id: 'snatch', name: 'Snatch', aliases: ['power snatch', 'squat snatch'], defaultEquipment: 'Barbell', notebooks: ['olympic'], recent: false, category: 'Olympic' },
  { id: 'burpee', name: 'Burpee', aliases: ['chest to deck'], defaultEquipment: null, notebooks: ['conditioning'], recent: true, category: 'Conditioning' },
  { id: 'double-under', name: 'Double-Under', aliases: ['du', 'dubs', 'jump rope'], defaultEquipment: 'Jump Rope', notebooks: ['conditioning'], recent: false, category: 'Monostructural' },
  { id: 'wall-ball', name: 'Wall Ball', aliases: ['wb', 'wall ball shot'], defaultEquipment: 'Medicine Ball', notebooks: ['conditioning'], recent: false, category: 'Squat' },
  { id: 'turkish-get-up', name: 'Turkish Get-Up', aliases: ['tgu', 'get up'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell'], recent: true, category: 'Core' },
  { id: 'goblet-squat', name: 'Goblet Squat', aliases: ['kb goblet'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'strength'], recent: false, category: 'Squat' },
  { id: 'push-up', name: 'Push-up', aliases: ['pushup'], defaultEquipment: null, notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
  { id: 'ring-dip', name: 'Ring Dip', aliases: ['dips'], defaultEquipment: 'Rings', notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
  { id: 'toes-to-bar', name: 'Toes-to-Bar', aliases: ['t2b', 'ttb'], defaultEquipment: 'Pull-Up Bar', notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
  { id: 'handstand-push-up', name: 'Handstand Push-up', aliases: ['hspu'], defaultEquipment: null, notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
  { id: 'walking-lunge', name: 'Walking Lunge', aliases: ['lunges', 'lunge'], defaultEquipment: 'Dumbbells', notebooks: ['strength'], recent: false, category: 'Squat' },
  { id: 'sled-push', name: 'Sled Push', aliases: ['prowler'], defaultEquipment: 'Sled', notebooks: ['conditioning'], recent: false, category: 'Conditioning' },
  { id: 'farmer-carry', name: 'Farmer Carry', aliases: ['carry', 'farmers walk'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'strength'], recent: false, category: 'Carry' },
];

export const BASE_EQUIPMENT: EquipmentDef[] = [
  { id: 'kettlebell', name: 'Kettlebell', desc: 'Cast-iron or competition bell' },
  { id: 'barbell', name: 'Barbell', desc: '20kg / 45lb Olympic bar' },
  { id: 'pull-up-bar', name: 'Pull-Up Bar', desc: 'Rig or doorway bar' },
  { id: 'dumbbells', name: 'Dumbbells', desc: 'Matched pair' },
  { id: 'rower', name: 'Rower', desc: 'Concept2 / indoor erg' },
  { id: 'assault-bike', name: 'Assault Bike', desc: 'Fan air bike' },
  { id: 'box', name: 'Box', desc: '20 / 24 / 30 in plyo box' },
  { id: 'rings', name: 'Rings', desc: 'Gymnastic wooden rings' },
  { id: 'jump-rope', name: 'Jump Rope', desc: 'Speed cable rope' },
  { id: 'sled', name: 'Sled', desc: 'Turf push/pull sled' },
  { id: 'medicine-ball', name: 'Medicine Ball', desc: 'Wall ball / slam ball' },
];

export const BASE_TAGS: TagDef[] = [
  { slug: 'emom', group: 'Format', desc: 'Every Minute On the Minute pacing' },
  { slug: 'amrap', group: 'Format', desc: 'As Many Rounds As Possible' },
  { slug: 'tabata', group: 'Format', desc: '20s work / 10s rest intervals' },
  { slug: 'for-time', group: 'Format', desc: 'Timed completion benchmark' },
  { slug: 'chipper', group: 'Format', desc: 'Single-pass high-rep sequence' },
  { slug: 'strength', group: 'Focus', desc: 'Heavy primary lift progression' },
  { slug: 'conditioning', group: 'Focus', desc: 'Metabolic / aerobic work capacity' },
  { slug: 'heavy', group: 'Focus', desc: 'High intensity >= 80% 1RM' },
  { slug: 'mobility', group: 'Focus', desc: 'Joint prep & cooldown flow' },
  { slug: 'recovery', group: 'Focus', desc: 'Zone 2 or restorative pacing' },
  { slug: 'core', group: 'Focus', desc: 'Midline stability & bracing' },
  { slug: 'kettlebell', group: 'Modality', desc: 'Single or double bell work' },
  { slug: 'barbell', group: 'Modality', desc: 'Olympic or powerlifting bar' },
  { slug: 'gymnastics', group: 'Modality', desc: 'Bodyweight rig & floor skills' },
  { slug: 'monostructural', group: 'Modality', desc: 'Run, row, bike, ski, jump rope' },
  { slug: 'sound-classic', group: 'Audio', desc: 'Classic 3-2-1 interval tone' },
];

export const BASE_WIKI_NOTES: WikiNoteDef[] = [
  { slug: 'benchmark-fran', title: 'Benchmark Fran', tags: ['#for-time', '#barbell'], summary: '21-15-9 Thruster @43kg & Pull-up' },
  { slug: 'kettlebell-foundations', title: 'Kettlebell Foundations', tags: ['#kettlebell', '#conditioning'], summary: 'Hinge mechanics, swing & TGU progressions' },
  { slug: 'squat-cycle-w4', title: 'Squat Cycle W4', tags: ['#strength', '#heavy'], summary: '5x5 Back Squat linear progression' },
  { slug: 'emom-conditioning-guide', title: 'EMOM Conditioning Guide', tags: ['#emom', '#conditioning'], summary: 'Pacing caps and work-to-rest ratios' },
  { slug: 'zone-2-running-notes', title: 'Zone 2 Running Notes', tags: ['#recovery', '#monostructural'], summary: 'Aerobic base intervals & nasal cadence' },
  { slug: 'mobility-warmup', title: 'Mobility Warmup', tags: ['#mobility'], summary: '10-minute hip & thoracic prep flow' },
  { slug: 'hero-murph', title: 'Hero Murph', tags: ['#for-time', '#gymnastics'], summary: '1 mile Run, 100 Pull-up, 200 Push-up, 300 Squat' },
  { slug: 'olympic-lifting-cues', title: 'Olympic Lifting Cues', tags: ['#barbell', '#strength'], summary: 'Snatch & Clean pull checkpoints' },
];

export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  { id: 'emom', name: 'EMOM', desc: 'Minute-by-minute work cap', lines: ['10:00 EMOM', '  15 Kettlebell Swing @24kg #emom'] },
  { id: 'amrap', name: 'AMRAP', desc: 'Continuous rounds in time window', lines: ['12:00 AMRAP', '  10 Pull-up', '  15 Push-up', '  200m Run #amrap'] },
  { id: 'tabata', name: 'Tabata', desc: '8 rounds of 20s work / 10s rest', lines: ['(8) Tabata', '  :20 Air Bike', '  *0:10 [:rest] #tabata'] },
  { id: '5x5', name: '5x5 Strength', desc: 'Sets x reps barbell progression', lines: ['5x5 Back Squat @100kg *2:00 #strength'] },
  { id: 'circuit', name: 'Circuit', desc: 'Multi-station timed rounds', lines: ['(3) Rounds', '  400m Run', '  15 Wall Ball 9kg', '  *1:00 [:rest]'] },
  { id: 'ladder', name: 'Ladder (21-15-9)', desc: 'Descending rep scheme', lines: ['(21-15-9)', '  Thruster @43kg', '  Pull-up #for-time'] },
  { id: 'choice', name: 'Choice (A | B)', desc: 'Scaled or equipment alternative', lines: ['(5) Rounds', '  15 Kettlebell Swing 24 | 16 kg', '  Run | Row 400m'] },
  { id: 'superset', name: 'Superset (+)', desc: 'Paired A/B lap block', lines: ['+ 5x5 Back Squat @100kg', '+ 10 Box Jump *1:30'] },
  { id: 'collectible', name: 'Collectible (:?)', desc: 'Open clock measure-until-done', lines: [':? 2000m Row #for-time'] },
];

export const SPORT_DIALECTS = [
  { id: '', label: 'General', desc: 'Standard WhiteboardScript rules' },
  { id: 'cardio', label: ':cardio', desc: 'Pace, split & distance defaults' },
  { id: 'strength', label: ':strength', desc: 'Load, %1RM & rest timers' },
  { id: 'climb', label: ':climb', desc: 'Hangboard & route grades' },
  { id: 'yoga', label: ':yoga', desc: 'Breath & hold cues' },
];

export const ACTION_CUES = [
  { code: '[:rest]', label: 'Rest Cue', desc: 'Mark an active rest transition' },
  { code: '[:next]', label: 'Advance Segment', desc: 'Skip forward on completion' },
  { code: '[:done]', label: 'Complete Block', desc: 'Finish timer when reached' },
  { code: '[:mark]', label: 'Split / Lap', desc: 'Record a split timestamp' },
];

export const PROPERTY_CUES = [
  { code: 'sound: #sound-classic', label: 'Sound Cue', desc: 'Play #sound-classic at interval boundaries' },
  { code: 'rpe: 8', label: 'Target RPE', desc: 'Rate of perceived exertion (1-10)' },
  { code: 'tempo: 3010', label: 'Lift Tempo', desc: 'Eccentric-pause-concentric cadence' },
];

export const PROTO_SCENARIOS: Record<ScenarioPreset['id'], ScenarioPreset> = {
  emom: {
    id: 'emom',
    label: 'EMOM + Strength',
    focusTarget: 'first-wod',
    doc: [
      '---',
      'notebook: kettlebell',
      'tags: [conditioning, strength]',
      '---',
      '',
      '# Tuesday Conditioning & Strength',
      '',
      'Compare pacing with [[Benchmark Fran]] and keep nasal breathing during #recovery intervals.',
      '',
      '```time',
      '10:00 EMOM',
      '  15 Kettlebell Swing @24kg #emom',
      '5x5 Back Squat @100kg #heavy',
      '400m Run *1:00',
      ':30 Plank [:rest]',
      '12 MysteryMovement 20kg #newtag',
      '```',
    ].join('\n'),
  },
  empty: {
    id: 'empty',
    label: 'Empty Starter',
    focusTarget: 'first-wod',
    doc: [
      '---',
      'notebook: kettlebell',
      'tags: [conditioning]',
      '---',
      '',
      '# My Workout',
      '',
      'Drafting a new session — pick a template below or type directly inside the fence.',
      '',
      '```time',
      '',
      '```',
    ].join('\n'),
  },
  lint: {
    id: 'lint',
    label: 'Lint & Repair',
    focusTarget: 'first-wod',
    doc: [
      '---',
      'notebook: conditioning',
      'tags: [for-time]',
      '---',
      '',
      '# Interval Draft (Diagnostics)',
      '',
      'Reviewing syntax errors and unresolved movements before starting the timer.',
      '',
      '```time:cardio',
      '400m Run :rest',
      '21-15-9 Thruster @43kg',
      '10 MysteryMove #unlinked',
      '```',
    ].join('\n'),
  },
  prose: {
    id: 'prose',
    label: 'Prose & Wiki',
    focusTarget: 'first-prose',
    doc: [
      '---',
      'notebook: strength',
      'tags: [strength, mobility]',
      '---',
      '',
      '# Training Block Notes',
      '',
      'Start with [[Mobility Warmup]] before loading [[Squat Cycle W4]] today.',
      'Focus on **bar path** and smooth transitions on #heavy sets.',
      '',
      '```log:strength',
      '5x5 Back Squat @100kg #heavy',
      '3x8 Walking Lunge 24kg',
      '```',
    ].join('\n'),
  },
};

export function createInitialCatalogs(): CatalogStore {
  return {
    efforts: BASE_EFFORTS.map((e) => ({ ...e, aliases: [...e.aliases], notebooks: [...e.notebooks] })),
    equipment: BASE_EQUIPMENT.map((e) => ({ ...e })),
    tags: BASE_TAGS.map((t) => ({ ...t })),
    wikiNotes: BASE_WIKI_NOTES.map((w) => ({ ...w, tags: [...w.tags] })),
  };
}

export function slugify(input: string): string {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

export function formatMmSs(mode: TimerMode, mins: number, secs: number): string {
  const m = Math.max(0, Math.floor(mins) || 0);
  const s = Math.max(0, Math.min(59, Math.floor(secs) || 0));
  if (mode === 'collectible') return ':?';
  const prefix = mode === 'rest' ? '*' : mode === 'countup' ? '^' : '';
  const base = m > 0 ? `${m}:${s < 10 ? '0' : ''}${s}` : `:${s < 10 ? '0' : ''}${s}`;
  return `${prefix}${base}`;
}

export function tokenChipDescriptor(tok: ParsedToken): { icon: string; text: string; sub: string } {
  switch (tok.kind) {
    case 'duration': {
      const modeTag = tok.meta.mode === 'rest' ? 'Rest' : tok.meta.mode === 'countup' ? 'Up' : tok.meta.mode === 'collectible' ? 'Measure' : 'Timer';
      return { icon: tok.meta.mode === 'rest' ? 'rest' : 'timer', text: tok.raw, sub: modeTag };
    }
    case 'scheme':
    case 'rounds':
      return { icon: 'rounds', text: tok.raw, sub: 'Rounds' };
    case 'rep':
      return { icon: 'rep', text: `${tok.raw} reps`, sub: 'Reps' };
    case 'effort':
      return { icon: 'effort', text: tok.raw, sub: 'Effort' };
    case 'equipment':
      return { icon: 'equipment', text: tok.raw, sub: 'Gear' };
    case 'resistance':
      return { icon: 'resistance', text: tok.raw, sub: 'Load' };
    case 'distance':
      return { icon: 'distance', text: tok.raw, sub: 'Dist' };
    case 'action':
    case 'property':
      return { icon: 'action', text: tok.raw, sub: 'Action' };
    case 'tag':
      return { icon: 'tag', text: tok.raw, sub: 'Tag' };
    case 'unresolved':
      return { icon: 'warning', text: `? ${tok.raw}`, sub: 'Define' };
    case 'lintError':
      return { icon: 'error', text: `! ${tok.raw}`, sub: 'Fix' };
    default:
      return { icon: 'code', text: tok.raw, sub: '' };
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findEffortMatchAt(text: string, idx: number, catalogs: CatalogStore): Omit<ParsedToken, 'id'> | null {
  const sub = text.slice(idx);
  let best: Omit<ParsedToken, 'id'> | null = null;
  for (const eff of catalogs.efforts) {
    const candidates = [eff.name, ...eff.aliases];
    for (const name of candidates) {
      if (!name) continue;
      const re = new RegExp(`^${escapeRegExp(name)}(?=$|[\\s,|#\\[\\]{}])`, 'i');
      const m = re.exec(sub);
      if (m && (!best || m[0].length > best.raw.length)) {
        best = {
          kind: 'effort',
          raw: m[0],
          from: idx,
          to: idx + m[0].length,
          meta: { effortId: eff.id, effortName: eff.name, equipment: eff.defaultEquipment },
        };
      }
    }
  }
  return best;
}

function findEquipmentMatchAt(text: string, idx: number, catalogs: CatalogStore): Omit<ParsedToken, 'id'> | null {
  const sub = text.slice(idx);
  let best: Omit<ParsedToken, 'id'> | null = null;
  for (const eq of catalogs.equipment) {
    const re = new RegExp(`^${escapeRegExp(eq.name)}(?=$|[\\s,|#\\[\\]{}])`, 'i');
    const m = re.exec(sub);
    if (m && (!best || m[0].length > best.raw.length)) {
      best = {
        kind: 'equipment',
        raw: m[0],
        from: idx,
        to: idx + m[0].length,
        meta: { equipmentId: eq.id, equipmentName: eq.name },
      };
    }
  }
  return best;
}

export function parseWodLine(text: string, lineNum: number, catalogs: CatalogStore): ParsedWodLine {
  const tokens: ParsedToken[] = [];
  const errors: LintIssue[] = [];
  const str = String(text || '');
  const n = str.length;
  let i = 0;

  const pushTok = (kind: TokenKind, raw: string, from: number, to: number, meta: TokenMeta = {}) => {
    const tok: ParsedToken = { id: `l${lineNum}_t${tokens.length}_${from}`, kind, raw, from, to, meta };
    tokens.push(tok);
    return tok;
  };

  while (i < n) {
    if (/\s/.test(str[i])) {
      i++;
      continue;
    }

    const rest = str.slice(i);

    if (rest.startsWith('//')) {
      const cEnd = rest.indexOf('#');
      const cRaw = cEnd > 0 ? rest.slice(0, cEnd).trimEnd() : rest;
      pushTok('comment', cRaw, i, i + cRaw.length);
      i += cRaw.length;
      continue;
    }

    if (i === 0 && /^#\s+/.test(str)) {
      pushTok('comment', str, 0, n, { isHeading: true });
      break;
    }

    if (tokens.length === 0) {
      const propM = /^([a-zA-Z][a-zA-Z0-9]*):\s+(#[a-zA-Z0-9-]+|"[^"]*"|[a-zA-Z0-9]+)/.exec(rest);
      if (propM) {
        pushTok('property', propM[0], i, i + propM[0].length, { key: propM[1], val: propM[2] });
        i += propM[0].length;
        continue;
      }
    }

    if (tokens.length === 0 && /^[+-](?=\s)/.test(rest)) {
      pushTok('action', rest[0], i, i + 1, { lap: true });
      i += 1;
      continue;
    }

    const actM = /^\[:[a-zA-Z0-9-]+\]/.exec(rest);
    if (actM) {
      pushTok('action', actM[0], i, i + actM[0].length);
      i += actM[0].length;
      continue;
    }

    const badColonM = /^:[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
    if (badColonM) {
      const msg = `Unexpected "${badColonM[0]}" — use *1:00 for a timed rest interval or [:${badColonM[0].slice(1)}] for an action cue.`;
      const fixes = ['*1:00', `[:${badColonM[0].slice(1)}]`];
      const tok = pushTok('lintError', badColonM[0], i, i + badColonM[0].length, { message: msg, fixes });
      errors.push({ token: tok, message: msg, fixes });
      i += badColonM[0].length;
      continue;
    }

    const durM = /^([*^]?)(:\?|\d*:\d{2}(?::\d{2})?)/.exec(rest);
    if (durM) {
      const prefix = durM[1];
      const body = durM[2];
      const mode: TimerMode = body === ':?' ? 'collectible' : prefix === '*' ? 'rest' : prefix === '^' ? 'countup' : 'countdown';
      let mins = 0;
      let secs = 0;
      if (body !== ':?') {
        const parts = body.split(':');
        if (parts.length === 2) {
          mins = parseInt(parts[0] || '0', 10) || 0;
          secs = parseInt(parts[1] || '0', 10) || 0;
        } else if (parts.length === 3) {
          mins = (parseInt(parts[0] || '0', 10) || 0) * 60 + (parseInt(parts[1] || '0', 10) || 0);
          secs = parseInt(parts[2] || '0', 10) || 0;
        }
      }
      pushTok('duration', durM[0], i, i + durM[0].length, { mode, mins, secs });
      i += durM[0].length;
      continue;
    }

    const tagM = /^#[a-zA-Z0-9-]*/.exec(rest);
    if (tagM) {
      const slug = tagM[0].slice(1);
      const resolvedTag = catalogs.tags.find((t) => t.slug.toLowerCase() === slug.toLowerCase()) ?? null;
      pushTok(resolvedTag ? 'tag' : 'unresolved', tagM[0], i, i + tagM[0].length, {
        slug,
        isTag: true,
        tagInfo: resolvedTag,
      });
      i += tagM[0].length;
      continue;
    }

    const schemeM = /^(\d+)\s*[xX]\s*(\d+)\b/.exec(rest);
    if (schemeM) {
      pushTok('scheme', schemeM[0], i, i + schemeM[0].length, {
        sets: parseInt(schemeM[1], 10),
        reps: parseInt(schemeM[2], 10),
      });
      i += schemeM[0].length;
      continue;
    }

    const grpM = /^\(([^)\n]+)\)/.exec(rest);
    if (grpM) {
      pushTok('rounds', grpM[0], i, i + grpM[0].length, { inner: grpM[1] });
      i += grpM[0].length;
      continue;
    }

    const bareLadderM = /^\d+(?:-\d+){2,}\b/.exec(rest);
    if (bareLadderM) {
      const msg = `Rep ladders need parentheses so rounds parse cleanly — use (${bareLadderM[0]}).`;
      const fixes = [`(${bareLadderM[0]})`];
      const tok = pushTok('lintError', bareLadderM[0], i, i + bareLadderM[0].length, { message: msg, fixes });
      errors.push({ token: tok, message: msg, fixes });
      i += bareLadderM[0].length;
      continue;
    }

    const kwM = /^(EMOM|AMRAP|Tabata|Rounds)\b/i.exec(rest);
    if (kwM) {
      pushTok('rounds', kwM[0], i, i + kwM[0].length, { keyword: kwM[0].toUpperCase() });
      i += kwM[0].length;
      continue;
    }

    const resAltM = /^(@?)(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*(kg|lbs?|pood|%)\b/i.exec(rest);
    if (resAltM) {
      pushTok('resistance', resAltM[0], i, i + resAltM[0].length, {
        hasAt: resAltM[1] === '@',
        amount: parseFloat(resAltM[2]),
        altAmount: parseFloat(resAltM[3]),
        unit: resAltM[4].toLowerCase(),
      });
      i += resAltM[0].length;
      continue;
    }

    const resM = /^(@?)(\d+(?:\.\d+)?|1\/2|1\/4)\s*(kg|lbs?|pood|%)\b/i.exec(rest);
    if (resM) {
      pushTok('resistance', resM[0], i, i + resM[0].length, {
        hasAt: resM[1] === '@',
        amount: resM[2],
        altAmount: null,
        unit: resM[3].toLowerCase(),
      });
      i += resM[0].length;
      continue;
    }

    const distM = /^(1\/4|1\/2|3\/4|\d+(?:\.\d+)?)\s*(m|km|cal|ft|mi|mile|yd)\b/i.exec(rest);
    if (distM) {
      pushTok('distance', distM[0], i, i + distM[0].length, {
        amount: distM[1],
        unit: distM[2].toLowerCase(),
      });
      i += distM[0].length;
      continue;
    }

    const repM = /^@?\d+(?:\.\d+)?\b/.exec(rest);
    if (repM) {
      const hasAtRep = repM[0][0] === '@';
      const valRep = parseFloat(hasAtRep ? repM[0].slice(1) : repM[0]);
      pushTok('rep', repM[0], i, i + repM[0].length, { reps: valRep, hasAt: hasAtRep });
      i += repM[0].length;
      continue;
    }

    if (rest[0] === '|' || rest[0] === '/') {
      pushTok('action', rest[0], i, i + 1, { separator: true });
      i += 1;
      continue;
    }

    const effMatch = findEffortMatchAt(str, i, catalogs);
    if (effMatch) {
      pushTok(effMatch.kind, effMatch.raw, effMatch.from, effMatch.to, effMatch.meta);
      i = effMatch.to;
      continue;
    }

    const eqMatch = findEquipmentMatchAt(str, i, catalogs);
    if (eqMatch) {
      pushTok(eqMatch.kind, eqMatch.raw, eqMatch.from, eqMatch.to, eqMatch.meta);
      i = eqMatch.to;
      continue;
    }

    const wordM = /^[^\s|/#[\]{}]+/.exec(rest);
    if (wordM) {
      pushTok('unresolved', wordM[0], i, i + wordM[0].length, { isTag: false, rawName: wordM[0] });
      i += wordM[0].length;
      continue;
    }

    i++;
  }

  return { lineNum, text: str, tokens, errors };
}

export function compileBlockSummary(lines: ParsedWodLine[]): BlockSummary {
  let totalSeconds = 0;
  let roundsCount = 0;
  let errCount = 0;
  let unresolvedCount = 0;
  let nonEmptyLines = 0;
  const timeline: BlockTimelineItem[] = [];

  for (const pl of lines) {
    if (pl.text.trim()) nonEmptyLines++;
    errCount += pl.errors.length;
    let lineDur = 0;
    let isRestLine = false;
    const labelParts: string[] = [];

    for (const tok of pl.tokens) {
      if (tok.kind === 'unresolved') unresolvedCount++;
      if (tok.kind === 'duration') {
        const secs = (tok.meta.mins || 0) * 60 + (tok.meta.secs || 0);
        totalSeconds += secs;
        lineDur += secs;
        if (tok.meta.mode === 'rest') isRestLine = true;
      }
      if (tok.kind === 'rounds') {
        const num = parseInt(tok.meta.inner || '0', 10);
        if (num > 0) roundsCount = Math.max(roundsCount, num);
      }
      if (tok.kind === 'effort' || tok.kind === 'unresolved' || tok.kind === 'action' || tok.kind === 'distance') {
        labelParts.push(tok.raw);
      }
    }

    if (pl.text.trim()) {
      timeline.push({
        lineNum: pl.lineNum,
        raw: pl.text.trim(),
        seconds: lineDur,
        isRest: isRestLine,
        hasError: pl.errors.length > 0,
        label: labelParts.join(' ') || pl.text.trim(),
      });
    }
  }

  const mins = Math.floor(totalSeconds / 60);
  const remSecs = totalSeconds % 60;
  const durLabel = totalSeconds > 0 ? `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}` : 'Open';
  return { nonEmptyLines, totalSeconds, durLabel, roundsCount, errCount, unresolvedCount, timeline };
}

export function scanDocument(docText: string, catalogs: CatalogStore): DocAnalysis {
  const rawLines = docText.split('\n');
  let title = 'Untitled Workout';
  let notebook = 'kettlebell';
  const fmTags: string[] = [];
  let fmStart: number | null = null;
  let fmEnd: number | null = null;
  let fmTagsLine: number | null = null;

  let lineCursor = 0;
  if (rawLines[0]?.trim() === '---') {
    fmStart = 1;
    for (let i = 1; i < rawLines.length; i++) {
      const ln = rawLines[i];
      if (ln.trim() === '---') {
        fmEnd = i + 1;
        lineCursor = i + 1;
        break;
      }
      const nbM = /^notebook:\s*(.+)$/.exec(ln.trim());
      if (nbM) notebook = nbM[1].trim();
      const tM = /^tags:\s*\[([^\]]*)\]/.exec(ln.trim());
      if (tM) {
        fmTagsLine = i + 1;
        tM[1]
          .split(',')
          .map((s) => s.trim().replace(/^#/, ''))
          .filter(Boolean)
          .forEach((s) => fmTags.push(`#${s}`));
      }
    }
  }

  const blocks: DocBlock[] = [];
  const wodLineMap = new Map<number, { blockIdx: number; parsed: ParsedWodLine }>();
  const fenceLineMap = new Map<number, { blockIdx: number; role: 'open' | 'close' }>();
  const proseLineSet = new Set<number>();

  let currentBlock: {
    blockIdx: number;
    dialect: Dialect;
    sport: string;
    fenceStartLine: number;
    lines: ParsedWodLine[];
  } | null = null;

  for (let idx = lineCursor; idx < rawLines.length; idx++) {
    const lineNum = idx + 1;
    const lineText = rawLines[idx];

    if (!currentBlock) {
      const openM = /^```(time|log|query)(?::([a-zA-Z0-9_-]+))?\s*$/.exec(lineText.trim());
      if (openM) {
        const blockIdx = blocks.length;
        currentBlock = {
          blockIdx,
          dialect: openM[1] as Dialect,
          sport: openM[2] ?? '',
          fenceStartLine: lineNum,
          lines: [],
        };
        fenceLineMap.set(lineNum, { blockIdx, role: 'open' });
        continue;
      }

      const h1M = /^#\s+(.+)$/.exec(lineText);
      if (h1M && title === 'Untitled Workout') {
        title = h1M[1].trim();
        continue;
      }

      if (lineText.trim()) {
        proseLineSet.add(lineNum);
      }
    } else {
      if (/^```\s*$/.test(lineText.trim())) {
        fenceLineMap.set(lineNum, { blockIdx: currentBlock.blockIdx, role: 'close' });
        const contentStartLine = currentBlock.fenceStartLine + 1;
        const contentEndLine = Math.max(contentStartLine - 1, lineNum - 1);
        blocks.push({
          blockIdx: currentBlock.blockIdx,
          dialect: currentBlock.dialect,
          sport: currentBlock.sport,
          fenceStartLine: currentBlock.fenceStartLine,
          fenceEndLine: lineNum,
          contentStartLine,
          contentEndLine,
          lines: currentBlock.lines,
          summary: compileBlockSummary(currentBlock.lines),
        });
        currentBlock = null;
        continue;
      }

      const parsed = parseWodLine(lineText, lineNum, catalogs);
      currentBlock.lines.push(parsed);
      wodLineMap.set(lineNum, { blockIdx: currentBlock.blockIdx, parsed });
    }
  }

  // Handle unclosed fence gracefully
  if (currentBlock) {
    const contentStartLine = currentBlock.fenceStartLine + 1;
    const contentEndLine = rawLines.length;
    blocks.push({
      blockIdx: currentBlock.blockIdx,
      dialect: currentBlock.dialect,
      sport: currentBlock.sport,
      fenceStartLine: currentBlock.fenceStartLine,
      fenceEndLine: rawLines.length + 1,
      contentStartLine,
      contentEndLine,
      lines: currentBlock.lines,
      summary: compileBlockSummary(currentBlock.lines),
    });
  }

  // Collect entities across frontmatter, prose, and WOD blocks
  const tagsMap = new Map<string, string>();
  const effortsMap = new Map<string, string>();
  const equipmentMap = new Map<string, string>();
  const unresolvedMap = new Map<string, NoteEntities['unresolved'][number]>();
  const errorList: NoteEntities['errors'] = [];

  for (const t of fmTags) tagsMap.set(t.toLowerCase(), t);

  for (const pLineNum of proseLineSet) {
    const pText = rawLines[pLineNum - 1] ?? '';
    const tagRe = /(?:^|\s)(#[a-zA-Z0-9-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(pText)) !== null) {
      tagsMap.set(m[1].toLowerCase(), m[1]);
    }
  }

  for (const blk of blocks) {
    for (const pl of blk.lines) {
      for (const tok of pl.tokens) {
        if (tok.kind === 'tag') {
          tagsMap.set(tok.raw.toLowerCase(), tok.raw);
        } else if (tok.kind === 'effort') {
          if (tok.meta.effortId && tok.meta.effortName) {
            effortsMap.set(tok.meta.effortId, tok.meta.effortName);
          }
          if (tok.meta.equipment) {
            equipmentMap.set(slugify(tok.meta.equipment), tok.meta.equipment);
          }
        } else if (tok.kind === 'equipment' && tok.meta.equipmentId && tok.meta.equipmentName) {
          equipmentMap.set(tok.meta.equipmentId, tok.meta.equipmentName);
        } else if (tok.kind === 'unresolved') {
          if (!unresolvedMap.has(tok.raw)) {
            unresolvedMap.set(tok.raw, {
              raw: tok.raw,
              isTag: Boolean(tok.meta.isTag),
              blockIdx: blk.blockIdx,
              lineNum: pl.lineNum,
              token: tok,
            });
          }
        } else if (tok.kind === 'lintError') {
          errorList.push({
            raw: tok.raw,
            message: tok.meta.message ?? 'Syntax issue',
            fixes: tok.meta.fixes ?? [],
            blockIdx: blk.blockIdx,
            lineNum: pl.lineNum,
            token: tok,
          });
        }
      }
    }
  }

  return {
    title,
    frontmatter: { notebook, tags: fmTags, startLine: fmStart, endLine: fmEnd, tagsLine: fmTagsLine },
    blocks,
    entities: {
      tags: Array.from(tagsMap.values()),
      efforts: Array.from(effortsMap.entries()).map(([id, name]) => ({ id, name })),
      equipment: Array.from(equipmentMap.entries()).map(([id, name]) => ({ id, name })),
      unresolved: Array.from(unresolvedMap.values()),
      errors: errorList,
    },
    wodLineMap,
    fenceLineMap,
    proseLineSet,
  };
}

export function fuzzyMatches(query: string, fields: string[]): boolean {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = fields.join(' ').toLowerCase();
  if (hay.includes(q)) return true;
  return q.split(/\s+/).every((part) => hay.includes(part));
}

export function searchEfforts(query: string, activeNotebook: string, catalogs: CatalogStore): { scoped: EffortDef[]; other: EffortDef[] } {
  const nb = (activeNotebook || '').toLowerCase();
  const scoped: EffortDef[] = [];
  const other: EffortDef[] = [];
  for (const eff of catalogs.efforts) {
    const fields = [eff.name, eff.category, eff.defaultEquipment ?? '', ...eff.aliases];
    if (!fuzzyMatches(query, fields)) continue;
    if (eff.recent || (nb && eff.notebooks.includes(nb))) scoped.push(eff);
    else other.push(eff);
  }
  return { scoped, other };
}

export function searchTags(query: string, catalogs: CatalogStore): Record<string, TagDef[]> {
  const groups: Record<string, TagDef[]> = {};
  for (const t of catalogs.tags) {
    if (!fuzzyMatches(query, [`#${t.slug}`, t.group, t.desc])) continue;
    if (!groups[t.group]) groups[t.group] = [];
    groups[t.group].push(t);
  }
  return groups;
}

export function searchWikiNotes(query: string, catalogs: CatalogStore): WikiNoteDef[] {
  return catalogs.wikiNotes.filter((n) => fuzzyMatches(query, [n.title, n.slug, n.summary, ...n.tags]));
}

/* ── Safe Single-Line CodeMirror 6 Transaction Builders ─────────────────── */

function resolveFreshTokenOnLine(lineText: string, lineNum: number, tokenRef: ParsedToken, catalogs: CatalogStore): ParsedToken | null {
  const parsed = parseWodLine(lineText, lineNum, catalogs);
  return (
    parsed.tokens.find((t) => t.id === tokenRef.id || (t.raw === tokenRef.raw && t.from === tokenRef.from)) ??
    parsed.tokens.find((t) => t.raw === tokenRef.raw) ??
    null
  );
}

export function computeReplaceTokenChange(
  doc: Text,
  lineNum: number,
  tokenRef: ParsedToken,
  replacement: string,
  catalogs: CatalogStore,
): { from: number; to: number; insert: string; nextCursorPos: number } | null {
  if (lineNum < 1 || lineNum > doc.lines) return null;
  const line = doc.line(lineNum);
  const fresh = resolveFreshTokenOnLine(line.text, lineNum, tokenRef, catalogs);
  if (!fresh) return null;

  const from = Math.max(line.from, Math.min(line.from + fresh.from, line.to));
  const to = Math.max(from, Math.min(line.from + fresh.to, line.to));
  const insert = String(replacement || '').replace(/[\r\n]+/g, ' ').trim();
  if (!insert || line.text.slice(fresh.from, fresh.to) === insert) return null;

  return { from, to, insert, nextCursorPos: from + insert.length };
}

export function computeDeleteTokenChange(
  doc: Text,
  lineNum: number,
  tokenRef: ParsedToken,
  catalogs: CatalogStore,
): { from: number; to: number; insert: string } | null {
  if (lineNum < 1 || lineNum > doc.lines) return null;
  const line = doc.line(lineNum);
  const fresh = resolveFreshTokenOnLine(line.text, lineNum, tokenRef, catalogs);
  if (!fresh) return null;

  const indentMatch = /^(\s*)/.exec(line.text);
  const indent = indentMatch ? indentMatch[1] : '';
  const before = line.text.slice(0, fresh.from);
  const after = line.text.slice(fresh.to);
  const combined = `${before} ${after}`.trim().replace(/\s{2,}/g, ' ');
  const nextLineText = combined ? `${indent}${combined.replace(/^\s+/, '')}` : '';
  return { from: line.from, to: line.to, insert: nextLineText };
}

export function computeInsertTokenChange(
  doc: Text,
  lineNum: number,
  tokenText: string,
): { from: number; to: number; insert: string; nextCursorPos: number } | null {
  if (lineNum < 1 || lineNum > doc.lines) return null;
  const line = doc.line(lineNum);
  const clean = String(tokenText || '').replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return null;

  if (!line.text.trim()) {
    return { from: line.to, to: line.to, insert: clean, nextCursorPos: line.to + clean.length };
  }
  const trimmedLen = line.text.replace(/\s+$/, '').length;
  const insertAt = line.from + trimmedLen;
  return { from: insertAt, to: line.to, insert: ` ${clean}`, nextCursorPos: insertAt + 1 + clean.length };
}

export function computeUpdateFenceChange(
  doc: Text,
  fenceLineNum: number,
  patch: { dialect?: Dialect; sport?: string },
): { from: number; to: number; insert: string } | null {
  if (fenceLineNum < 1 || fenceLineNum > doc.lines) return null;
  const line = doc.line(fenceLineNum);
  const m = /^```(time|log|query)(?::([a-zA-Z0-9_-]+))?\s*$/.exec(line.text.trim());
  const curDialect = (m?.[1] as Dialect) ?? 'time';
  const curSport = m?.[2] ?? '';
  const nextDialect = patch.dialect ?? curDialect;
  const nextSport = patch.sport !== undefined ? patch.sport : curSport;
  const insert = '```' + nextDialect + (nextSport ? `:${nextSport}` : '');
  if (insert === line.text.trim()) return null;
  return { from: line.from, to: line.to, insert };
}

export function computeInsertTemplateChange(
  doc: Text,
  block: DocBlock,
  cursorLineNum: number,
  templateId: string,
): { from: number; to: number; insert: string; nextCursorPos: number } | null {
  const tpl = WORKOUT_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  const tplText = tpl.lines.join('\n');

  const isEmptyBlock = block.lines.length === 1 && !block.lines[0].text.trim();
  if (isEmptyBlock && block.contentStartLine <= doc.lines) {
    const emptyLine = doc.line(block.contentStartLine);
    return { from: emptyLine.from, to: emptyLine.to, insert: tplText, nextCursorPos: emptyLine.from };
  }

  const targetLineNum =
    cursorLineNum >= block.contentStartLine && cursorLineNum <= block.contentEndLine
      ? cursorLineNum
      : Math.max(block.fenceStartLine, block.contentEndLine);
  const anchorLine = doc.line(Math.min(targetLineNum, doc.lines));
  return {
    from: anchorLine.to,
    to: anchorLine.to,
    insert: `\n${tplText}`,
    nextCursorPos: anchorLine.to + 1,
  };
}

export function computeSmartIncrementChange(
  doc: Text,
  pos: number,
  delta: number,
  catalogs: CatalogStore,
): { from: number; to: number; insert: string; nextCursorPos: number } | null {
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  const parsed = parseWodLine(line.text, line.number, catalogs);
  const tok =
    parsed.tokens.find((t) => offset >= t.from && offset <= t.to) ??
    parsed.tokens.find((t) => t.kind === 'duration' || t.kind === 'resistance' || t.kind === 'rep' || t.kind === 'scheme');
  if (!tok) return null;

  let nextStr: string | null = null;
  if (tok.kind === 'duration' && tok.meta.mode !== 'collectible') {
    const step = delta > 0 ? 15 : -15;
    let total = (tok.meta.mins || 0) * 60 + (tok.meta.secs || 0) + step;
    total = Math.max(15, total);
    nextStr = formatMmSs(tok.meta.mode ?? 'countdown', Math.floor(total / 60), total % 60);
  } else if (tok.kind === 'rep') {
    const nextRep = Math.max(1, (tok.meta.reps || 10) + delta);
    nextStr = String(nextRep);
  } else if (tok.kind === 'resistance') {
    const num = parseFloat(String(tok.meta.amount ?? '20'));
    if (!Number.isNaN(num)) {
      const nextAmt = Math.max(1, num + (delta > 0 ? 5 : -5));
      const alt = tok.meta.altAmount ? ` | ${tok.meta.altAmount} ` : '';
      nextStr = `${tok.meta.hasAt ? '@' : ''}${nextAmt}${alt}${tok.meta.unit ?? 'kg'}`;
    }
  } else if (tok.kind === 'scheme') {
    const sets = tok.meta.sets || 5;
    const reps = Math.max(1, (tok.meta.reps || 5) + delta);
    nextStr = `${sets}x${reps}`;
  }

  if (!nextStr) return null;
  return computeReplaceTokenChange(doc, line.number, tok, nextStr, catalogs);
}

export function computeToggleFrontmatterTagChange(
  doc: Text,
  analysis: DocAnalysis,
  rawTag: string,
): { from: number; to: number; insert: string } | null {
  const slug = slugify(rawTag.replace(/^#/, ''));
  const current = analysis.frontmatter.tags.map((t) => t.replace(/^#/, ''));
  const idx = current.findIndex((s) => s.toLowerCase() === slug.toLowerCase());
  const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, slug];
  const tagsLineText = `tags: [${next.join(', ')}]`;

  if (analysis.frontmatter.tagsLine && analysis.frontmatter.tagsLine <= doc.lines) {
    const line = doc.line(analysis.frontmatter.tagsLine);
    return { from: line.from, to: line.to, insert: tagsLineText };
  }
  if (analysis.frontmatter.endLine && analysis.frontmatter.endLine <= doc.lines) {
    const endLine = doc.line(analysis.frontmatter.endLine);
    return { from: endLine.from, to: endLine.from, insert: `${tagsLineText}\n` };
  }
  return { from: 0, to: 0, insert: `---\nnotebook: kettlebell\n${tagsLineText}\n---\n\n` };
}

export function computeToggleProseFormatChange(
  doc: Text,
  lineNum: number,
  selFrom: number,
  selTo: number,
  kind: 'bold' | 'italic' | 'strike' | 'code' | 'wikiLink' | 'proseTag' | 'wrapTimeBlock',
  payload?: string,
): { from: number; to: number; insert: string; nextCursorPos?: number } | null {
  if (lineNum < 1 || lineNum > doc.lines) return null;
  const line = doc.line(lineNum);

  if (kind === 'wrapTimeBlock') {
    const cleaned = line.text.replace(/\*\*/g, '').replace(/\*/g, '').trim() || '10:00 AMRAP';
    const insert = `\`\`\`time\n${cleaned}\n\`\`\``;
    return { from: line.from, to: line.to, insert, nextCursorPos: line.from + 8 };
  }

  if (kind === 'wikiLink' && payload) {
    const linkText = `[[${payload}]]`;
    const at = Math.max(line.from, Math.min(selTo, line.to));
    const needSpace = at > line.from && !/\s/.test(doc.sliceString(at - 1, at));
    const insert = `${needSpace ? ' ' : ''}${linkText} `;
    return { from: at, to: at, insert, nextCursorPos: at + insert.length };
  }

  if (kind === 'proseTag' && payload) {
    const tagStr = payload.startsWith('#') ? payload : `#${payload}`;
    const at = Math.max(line.from, Math.min(selTo, line.to));
    const needSpace = at > line.from && !/\s/.test(doc.sliceString(at - 1, at));
    const insert = `${needSpace ? ' ' : ''}${tagStr} `;
    return { from: at, to: at, insert, nextCursorPos: at + insert.length };
  }

  const markers: Record<'bold' | 'italic' | 'strike' | 'code', string> = {
    bold: '**',
    italic: '*',
    strike: '~~',
    code: '`',
  };
  const m = markers[kind];

  // If the user has an actual selection inside this line, toggle directly around selection
  if (selFrom >= line.from && selTo <= line.to && selTo > selFrom) {
    const selected = doc.sliceString(selFrom, selTo);
    if (selected.startsWith(m) && selected.endsWith(m) && selected.length > m.length * 2) {
      const inner = selected.slice(m.length, -m.length);
      return { from: selFrom, to: selTo, insert: inner, nextCursorPos: selFrom + inner.length };
    }
    const wrapped = `${m}${selected}${m}`;
    return { from: selFrom, to: selTo, insert: wrapped, nextCursorPos: selFrom + wrapped.length };
  }

  // Collapsed caret: unwrap existing match on line or wrap "bar path" / word under caret
  const esc = escapeRegExp(m);
  const unwrapRe = new RegExp(`${esc}([^\\n]+?)${esc}`);
  if (unwrapRe.test(line.text)) {
    const nextLine = line.text.replace(unwrapRe, '$1');
    return { from: line.from, to: line.to, insert: nextLine };
  }

  if (line.text.includes('bar path')) {
    const nextLine = line.text.replace('bar path', `${m}bar path${m}`);
    return { from: line.from, to: line.to, insert: nextLine };
  }

  const words = line.text.trim().split(' ');
  if (words.length >= 2) {
    const tail = words.slice(-2).join(' ');
    const head = words.slice(0, -2).join(' ');
    const nextLine = `${head ? `${head} ` : ''}${m}${tail}${m}`;
    return { from: line.from, to: line.to, insert: nextLine };
  }
  const nextLine = `${m}${line.text.trim()}${m}`;
  return { from: line.from, to: line.to, insert: nextLine };
}
