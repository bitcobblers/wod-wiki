export interface SyntaxMeta {
  line: number;
  startOffset: number;
  endOffset: number;
  columnStart: number;
  columnEnd: number;
  length: number;
  raw: string;
}

interface BasePrimitive {
  kind: 'lap' | 'duration' | 'rounds' | 'round_scheme' | 'action' | 'text' | 'heading' | 'quantity' | 'effort' | 'property' | 'metric_object';
  raw: string;
  meta: SyntaxMeta;
}

export interface MetricObjectPrimitive extends BasePrimitive {
  kind: 'metric_object';
  pairs: Array<{ key: string; value: string | number | boolean | null | string[] }>;
}

export interface LapPrimitive extends BasePrimitive {
  kind: 'lap';
  lapType: 'round' | 'compose';
}

export interface DurationPrimitive extends BasePrimitive {
  kind: 'duration';
  timerRaw?: string;
  hasTrend: boolean;
  isRequired: boolean;
}

export interface RoundsPrimitive extends BasePrimitive {
  kind: 'rounds';
  sequence?: number[];
  label?: string;
}

/**
 * Inline NxM rounds scheme — `5x5` or `5 x 5` — lexed as one token so a bare
 * `x` inside effort words is never stolen. N rounds x M reps per round.
 */
export interface RoundSchemePrimitive extends BasePrimitive {
  kind: 'round_scheme';
  rounds: number;
  reps: number;
}

export interface ActionPrimitive extends BasePrimitive {
  kind: 'action';
  hasColonPrefix: boolean;
}

export interface TextPrimitive extends BasePrimitive {
  kind: 'text';
}
export interface HeadingPrimitive extends BasePrimitive {
  kind: 'heading';
}


export interface QuantityPrimitive extends BasePrimitive {
  kind: 'quantity';
  value?: number;
  hasAtSign: boolean;
}

/**
 * Effort primitive — emitted for any free text including the bare "/" and "|"
 * separator tokens. Slash/Pipe were grammar-level primitives consumed only by
 * fuseUnits; they now ride as `EffortPrimitive` with raw '/' or '|' and the
 * dialect matches the raw string:
 *   1/4 mile → 0.25 mile (slash converts to a single decimal)
 *   Run | Walk → ChoiceGroupMetric([Effort('Run'), Effort('Walk')]) (pipe groups)
 */
export interface EffortPrimitive extends BasePrimitive {
  kind: 'effort';
}

export interface PropertyPrimitive extends BasePrimitive {
  kind: 'property';
  key: string;
  valueRaw: string;
  value: string | number | boolean | null;
  /**
   * The tag slugs when the value is one or more tag references
   * (`#{tag-slug}`). Several can be stacked on one line.
   *
   * A tag reference names a tag rather than repeating what the tag means.
   * The parser records the references; resolving them to metrics is the
   * classifier's job, since only it knows the tag catalog.
   */
  tagRefs?: string[];
}

export type SyntaxPrimitive =
  | LapPrimitive
  | DurationPrimitive
  | RoundsPrimitive
  | RoundSchemePrimitive
  | ActionPrimitive
  | TextPrimitive
  | HeadingPrimitive
  | QuantityPrimitive
  | EffortPrimitive
  | PropertyPrimitive
  | MetricObjectPrimitive;
export interface SyntaxStatement {
  id: number;
  line: number;
  meta: SyntaxMeta;
  primitives: SyntaxPrimitive[];
  children: number[][];
  parentId?: number;
  isLeaf: boolean;
}

export interface SyntaxFacts {
  statements: SyntaxStatement[];
}
