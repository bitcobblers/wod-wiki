import type { Tree, SyntaxNode } from '@lezer/common';
import { parser } from '../grammar/parser';
import * as terms from '../grammar/parser.terms';
import {
  ActionPrimitive,
  DurationPrimitive,
  EffortPrimitive,
  HeadingPrimitive,
  LapPrimitive,
  MetricObjectPrimitive,
  PropertyPrimitive,
  QuantityPrimitive,
  RoundSchemePrimitive,
  RoundsPrimitive,
  SyntaxFacts,
  SyntaxMeta,
  SyntaxPrimitive,
  SyntaxStatement,
  TextPrimitive,
} from './syntax-facts';

/** Helper to compute line and column numbers from offset without EditorState */
export interface LineLocator {
  (offset: number): { lineNumber: number; lineStart: number };
}

export function createLineLocator(source: string): LineLocator {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStarts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIndex = high >= 0 ? high : 0;
    return {
      lineNumber: lineIndex + 1,
      lineStart: lineStarts[lineIndex],
    };
  };
}

export function extractSyntaxFacts(
  sourceOrState: string | { doc: { toString(): string } },
  treeArg?: Tree
): SyntaxFacts {
  const source = typeof sourceOrState === 'string' ? sourceOrState : sourceOrState.doc.toString();
  const parseSource = source.endsWith('\n') ? source : source + '\n';
  const tree = treeArg ?? parser.parse(parseSource);
  const locator = createLineLocator(source);

  const statements: SyntaxStatement[] = [];
  let lastProperty: { to: number; index: number } | null = null;

  tree.iterate({
    enter(node) {
      if (node.name === '⚠') {
        if (lastProperty && lastProperty.to === node.from) {
          statements.splice(lastProperty.index, 1);
        }
        lastProperty = null;
        return;
      }

      if (node.name === 'Property') {
        const primitive = createPropertyPrimitive(locator, source, node.from, node.to);
        if (primitive) {
          const meta = primitive.meta;
          // Structural identity: document-order ordinal, independent of the
          // physical line. Source location stays in `line`/`meta`.
          statements.push({
            id: statements.length,
            line: meta.line,
            meta,
            primitives: [primitive],
            children: [],
            isLeaf: true,
          });
          lastProperty = { to: node.to, index: statements.length - 1 };
        }
        return;
      }

      if (node.name !== 'Block') return;
      lastProperty = null;

      const statementMeta = createMeta(locator, node.from, node.to, source.slice(node.from, node.to));
      // Structural identity: document-order ordinal, independent of the
      // physical line. Source location stays in `line`/`meta`.
      const statement: SyntaxStatement = {
        id: statements.length,
        line: statementMeta.line,
        meta: statementMeta,
        primitives: [],
        children: [],
        isLeaf: true,
      };

      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          const child = cursor.node;
          const childRaw = source.slice(child.from, child.to);

          if (child.type.id === terms.Lap) {
            const lapPrimitive: LapPrimitive = {
              kind: 'lap',
              raw: childRaw,
              meta: createMeta(locator, child.from, child.to, childRaw),
              lapType: childRaw === '+' ? 'compose' : 'round',
            };
            statement.primitives.push(lapPrimitive);
            continue;
          }

          if (child.type.id !== terms.Fragment || !child.firstChild) {
            continue;
          }

          const fragmentNode = child.firstChild;
          const primitive = mapFragmentToPrimitive(locator, source, fragmentNode);
          if (primitive) statement.primitives.push(primitive);
        } while (cursor.nextSibling());
      }

      statements.push(statement);
    },
  });

  applyIndentationNesting(statements);

  return { statements };
}

function createPropertyPrimitive(
  locator: LineLocator,
  source: string,
  from: number,
  to: number
): PropertyPrimitive | null {
  const raw = source.slice(from, to);
  const meta = createMeta(locator, from, to, raw);
  const match = raw.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*?)\s*$/);

  if (!match) return null;

  const [, key, rawValue] = match;
  const tagRefs = parseTagRefs(rawValue);
  return {
    kind: 'property',
    raw,
    meta,
    key,
    valueRaw: rawValue,
    value: tagRefs !== undefined ? rawValue.trim() : parsePropertyValue(rawValue),
    ...(tagRefs !== undefined ? { tagRefs } : {}),
  };
}

/**
 * The tag slugs when a property value is one or more tag references
 * (`#{tag-slug}`).
 *
 * Returns `undefined` for any other value, including a bare word that
 * merely looks like one.
 */
function parseTagRefs(rawValue: string): string[] | undefined {
  const parts = rawValue.trim().split(/\s+/).filter(part => part.length > 0);
  if (parts.length === 0) return undefined;

  const slugs: string[] = [];
  for (const part of parts) {
    const match = part.match(/^#\{([a-zA-Z0-9][a-zA-Z0-9-]*)\}$/);
    if (!match) return undefined;
    slugs.push(match[1]);
  }
  return slugs;
}

function parsePropertyValue(rawValue: string): string | number | boolean | null {
  const trimmed = rawValue.trim();

  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/\\(["\\/bfnrt])/g, '$1');
  }

  if (/^-?(?:\d+\.\d+|\d+)$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;

  return trimmed;
}

function mapFragmentToPrimitive(
  locator: LineLocator,
  source: string,
  node: SyntaxNode
): SyntaxPrimitive | null {
  const raw = source.slice(node.from, node.to);
  const meta = createMeta(locator, node.from, node.to, raw);

  switch (node.type.id) {
    case terms.Duration: {
      const trend = node.getChild('Trend');
      const timerNode = node.getChild('Timer') || node.getChild('CollectibleTimer');

      const primitive: DurationPrimitive = {
        kind: 'duration',
        raw,
        meta,
        timerRaw: timerNode ? source.slice(timerNode.from, timerNode.to) : undefined,
        hasTrend: !!trend,
        isRequired: raw.includes('*'),
      };
      return primitive;
    }

    case terms.Rounds: {
      const sequence = node.getChild('Sequence');
      const label = node.getChild('Identifier');

      const primitive: RoundsPrimitive = {
        kind: 'rounds',
        raw,
        meta,
        sequence: sequence
          ? source
              .slice(sequence.from, sequence.to)
              .split('-')
              .map((n) => parseInt(n.trim(), 10))
          : undefined,
        label: label ? source.slice(label.from, label.to) : undefined,
      };
      return primitive;
    }

    case terms.RoundScheme: {
      const match = raw.match(/^(\d+)\s*[xX]\s*(\d+)$/);
      if (!match) return null;

      const primitive: RoundSchemePrimitive = {
        kind: 'round_scheme',
        raw,
        meta,
        rounds: parseInt(match[1], 10),
        reps: parseInt(match[2], 10),
      };
      return primitive;
    }

    case terms.Action: {
      const primitive: ActionPrimitive = {
        kind: 'action',
        raw,
        meta,
        hasColonPrefix: raw.startsWith('[:'),
      };
      return primitive;
    }

    case terms.Text: {
      const primitive: TextPrimitive = {
        kind: 'text',
        raw,
        meta,
      };
      return primitive;
    }

    case terms.Heading: {
      const primitive: HeadingPrimitive = {
        kind: 'heading',
        raw,
        meta,
      };
      return primitive;
    }

    case terms.Quantity: {
      const hasAtSign = !!node.getChild('AtSign');
      const numberNode = node.getChild('Number');

      const primitive: QuantityPrimitive = {
        kind: 'quantity',
        raw,
        meta,
        value: numberNode ? parseFloat(source.slice(numberNode.from, numberNode.to)) : undefined,
        hasAtSign,
      };
      return primitive;
    }

    case terms.Effort: {
      const primitive: EffortPrimitive = {
        kind: 'effort',
        raw,
        meta,
      };
      return primitive;
    }

    case terms.Slash: {
      const primitive: EffortPrimitive = {
        kind: 'effort',
        raw,
        meta,
      };
      return primitive;
    }

    case terms.Pipe: {
      const primitive: EffortPrimitive = {
        kind: 'effort',
        raw,
        meta,
      };
      return primitive;
    }

    case terms.MetricObject: {
      let pairs: Array<{ key: string; value: string | number | boolean | null | string[] }> = [];
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          pairs = Object.entries(parsed).map(([key, value]) => ({
            key,
            value: value as string | number | boolean | null | string[],
          }));
        }
      } catch {
        // Malformed JSON — emit empty pairs; raw text is still preserved
      }

      const primitive: MetricObjectPrimitive = {
        kind: 'metric_object',
        raw,
        meta,
        pairs,
      };
      return primitive;
    }

    default:
      return null;
  }
}

function applyIndentationNesting(statements: SyntaxStatement[]): void {
  const parentChildMap = new Map<number, number[]>();
  let stack: Array<{ columnStart: number; statement: SyntaxStatement }> = [];

  for (const statement of statements) {
    stack = stack.filter((item) => item.columnStart < statement.meta.columnStart);

    if (stack.length > 0) {
      for (const parent of stack) {
        if (!parentChildMap.has(parent.statement.id)) {
          parentChildMap.set(parent.statement.id, []);
        }
        parentChildMap.get(parent.statement.id)!.push(statement.id);
        statement.parentId = parent.statement.id;
      }
    }

    stack.push({ columnStart: statement.meta.columnStart, statement });
  }

  for (const statement of statements) {
    const flatChildren = parentChildMap.get(statement.id) ?? [];
    statement.children = groupChildrenByLap(flatChildren, statements);
    statement.isLeaf = statement.children.length === 0;
  }
}

function groupChildrenByLap(childIds: number[], statements: SyntaxStatement[]): number[][] {
  if (childIds.length === 0) return [];

  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const groups: number[][] = [];

  for (const childId of childIds) {
    const statement = byId.get(childId);
    const lap = statement?.primitives.find((primitive) => primitive.kind === 'lap') as
      | LapPrimitive
      | undefined;

    if (lap?.lapType === 'compose' && groups.length > 0) {
      groups[groups.length - 1].push(childId);
    } else {
      groups.push([childId]);
    }
  }

  return groups;
}

function createMeta(
  locator: LineLocator,
  from: number,
  to: number,
  raw: string
): SyntaxMeta {
  const { lineNumber, lineStart } = locator(from);

  return {
    line: lineNumber,
    startOffset: from,
    endOffset: to,
    columnStart: from - lineStart,
    columnEnd: to - lineStart,
    length: to - from,
    raw,
  };
}
