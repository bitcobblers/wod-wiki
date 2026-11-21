import type { SyntaxNode } from '@lezer/common';
import { parser } from '../grammar/parser';

/**
 * Edit plan returned by {@link computeWhiteboardEnterAction} for pressing
 * Enter inside a Whiteboard Script line. Columns are 0-based offsets into `lineText`.
 */
export interface WhiteboardEnterAction {
  /** Start column offset within the current line to replace (`0..lineText.length`). */
  readonly replaceFromCol: number;
  /** End column offset within the current line to replace (`0..lineText.length`). */
  readonly replaceToCol: number;
  /** Exact replacement text (always starts with `'\n'`). */
  readonly insert: string;
  /** Cursor offset relative to `replaceFromCol` after inserting `insert`. */
  readonly cursorOffset: number;
}

const ROUNDS_QUALIFIER_WORDS = /^(rounds?|rds?|sets?|laps?|cycles?|intervals?)$/i;
const CONTAINER_KEYWORDS = new Set(['amrap', 'emom', 'tabata']);

function hasAnyErrorNode(node: SyntaxNode): boolean {
  let found = false;
  node.cursor().iterate((cur) => {
    if (cur.type.isError) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

/**
 * True when `lineContent` is a structural container / rounds header line
 * (e.g. `(3)`, `(3 rounds)`, `(21-15-9)`, `(10) :60 EMOM`, `(8) :20 Work`,
 * `3 rounds`, `9-7-5`, `10:00 AMRAP`, `5x5`) without a leaf movement payload
 * (`(3) 10 Push-ups`, `5x5 Back Squat @100kg`, `(21-15-9) Thruster`).
 */
export function isRoundsHeaderLine(lineContent: string): boolean {
  const trimmed = lineContent.trim();
  if (!trimmed) return false;

  const source = `${trimmed}\n`;
  const tree = parser.parse(source);
  if (hasAnyErrorNode(tree.topNode)) return false;

  const topChildren: SyntaxNode[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'newline') topChildren.push(child);
  }
  if (topChildren.length !== 1 || topChildren[0].name !== 'Block') return false;

  const fragments = topChildren[0].getChildren('Fragment');
  if (fragments.length === 0) return false;

  let hasRoundsHeader = false;
  let hasContainerKeyword = false;
  let hasDuration = false;
  let hasLeafPayload = false;

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    const kind = frag.firstChild;
    if (!kind) {
      hasLeafPayload = true;
      break;
    }

    switch (kind.name) {
      case 'Rounds': {
        const raw = source.slice(kind.from, kind.to);
        if (!raw.endsWith(')')) return false;
        const seq = kind.getChild('Sequence');
        const idNode = kind.getChild('Identifier');
        if (!seq) {
          hasLeafPayload = true;
          break;
        }
        const numbers = seq.getChildren('Number');
        const idText = idNode ? source.slice(idNode.from, idNode.to) : '';
        if (numbers.length >= 2 && !idNode) {
          hasRoundsHeader = true;
        } else if (numbers.length === 1 && (!idNode || ROUNDS_QUALIFIER_WORDS.test(idText))) {
          hasRoundsHeader = true;
        } else {
          hasLeafPayload = true;
        }
        break;
      }

      case 'RoundScheme': {
        hasRoundsHeader = true;
        break;
      }

      case 'Duration': {
        hasDuration = true;
        break;
      }

      case 'Quantity': {
        const hasAtSign = Boolean(kind.getChild('AtSign'));
        const qtyRaw = source.slice(kind.from, kind.to);
        const isWholeInt = !hasAtSign && /^\d+$/.test(qtyRaw);
        if (!isWholeInt) {
          hasLeafPayload = true;
          break;
        }

        // Check for unparenthesized adjacent rep ladder (`9-7`, `9-7-5`, `9-7-5 reps`).
        let j = i;
        let rungCount = 1;
        while (
          j + 2 < fragments.length &&
          fragments[j + 1].firstChild?.name === 'Effort' &&
          source.slice(fragments[j + 1].from, fragments[j + 1].to) === '-' &&
          fragments[j + 1].from === fragments[j].to &&
          fragments[j + 2].firstChild?.name === 'Quantity' &&
          fragments[j + 2].from === fragments[j + 1].to &&
          /^\d+$/.test(source.slice(fragments[j + 2].from, fragments[j + 2].to))
        ) {
          rungCount++;
          j += 2;
        }

        if (rungCount >= 2) {
          hasRoundsHeader = true;
          i = j;
          if (
            i + 1 < fragments.length &&
            fragments[i + 1].firstChild?.name === 'Effort' &&
            /^reps?$/i.test(source.slice(fragments[i + 1].from, fragments[i + 1].to).trim())
          ) {
            i++;
          }
          break;
        }

        // Bare integer followed by explicit rounds qualifier (`3 rounds`, `5 sets`).
        if (
          i + 1 < fragments.length &&
          fragments[i + 1].firstChild?.name === 'Effort' &&
          ROUNDS_QUALIFIER_WORDS.test(source.slice(fragments[i + 1].from, fragments[i + 1].to).trim())
        ) {
          hasRoundsHeader = true;
          i++;
          break;
        }

        hasLeafPayload = true;
        break;
      }

      case 'Effort': {
        const raw = source.slice(kind.from, kind.to).trim().toLowerCase();
        if (
          raw === 'for' &&
          i + 1 < fragments.length &&
          fragments[i + 1].firstChild?.name === 'Effort' &&
          source.slice(fragments[i + 1].from, fragments[i + 1].to).trim().toLowerCase() === 'time'
        ) {
          hasContainerKeyword = true;
          i++;
          break;
        }
        if (CONTAINER_KEYWORDS.has(raw)) {
          hasContainerKeyword = true;
          break;
        }
        if (raw === 'work' && (hasRoundsHeader || hasDuration)) {
          break;
        }
        hasLeafPayload = true;
        break;
      }

      case 'TagRef':
      case 'Text':
        break;

      default:
        hasLeafPayload = true;
        break;
    }

    if (hasLeafPayload) break;
  }

  return (hasRoundsHeader || hasContainerKeyword) && !hasLeafPayload;
}

/**
 * Computes the single-line newline/indentation edit for pressing Enter inside
 * a Whiteboard Script line. Pure and synchronous; suitable for headless tests
 * and CodeMirror commands alike.
 */
export function computeWhiteboardEnterAction(
  lineText: string,
  fromCol: number,
  toCol = fromCol,
  unit = '  ',
): WhiteboardEnterAction {
  const indent = /^[ \t]*/.exec(lineText)![0];
  const before = lineText.slice(0, fromCol);
  const after = lineText.slice(toCol);
  const isCollapsed = fromCol === toCol;

  // 1. Blank / whitespace-only line: double-Enter resets indentation to col 0.
  if (lineText.trim() === '') {
    if (indent.length > 0) {
      return {
        replaceFromCol: 0,
        replaceToCol: lineText.length,
        insert: '\n',
        cursorOffset: 1,
      };
    }
    return {
      replaceFromCol: fromCol,
      replaceToCol: toCol,
      insert: '\n',
      cursorOffset: 1,
    };
  }

  // 2. Empty `-` or `+` lap marker line: second Enter clears marker & resets indent.
  if (/^([ \t]*)([+-])(?![+-])[ \t]*$/.test(lineText) && fromCol >= indent.length + 1) {
    return {
      replaceFromCol: 0,
      replaceToCol: lineText.length,
      insert: '\n',
      cursorOffset: 1,
    };
  }

  // 3. Cursor inside leading whitespace before non-empty content: clean line above, keep indent on next line.
  if (isCollapsed && fromCol <= indent.length && after.trim().length > 0) {
    const keptIndent = indent.slice(0, fromCol);
    return {
      replaceFromCol: 0,
      replaceToCol: fromCol,
      insert: `\n${keptIndent}`,
      cursorOffset: 1 + keptIndent.length,
    };
  }

  const leadingAfterSpaces = /^[ \t]+/.exec(after)?.[0].length ?? 0;

  // 4. Line starts with `+` or `-` lap marker before cursor.
  const markerMatch = /^([ \t]*)([+-])(?![+-])([ \t]*)(.*)$/.exec(before);
  if (markerMatch) {
    const marker = markerMatch[2];
    const contentBefore = markerMatch[4].trim();
    const nextPrefix = contentBefore.length > 0
      ? isRoundsHeaderLine(contentBefore)
        ? `${indent}${unit}`
        : `${indent}${marker} `
      : indent;
    return {
      replaceFromCol: fromCol,
      replaceToCol: toCol + leadingAfterSpaces,
      insert: `\n${nextPrefix}`,
      cursorOffset: 1 + nextPrefix.length,
    };
  }

  // 5. Regular line: indent after rounds/container headers, otherwise preserve indent.
  const beforeContent = before.slice(indent.length).trim();
  const nextPrefix = isRoundsHeaderLine(beforeContent) ? `${indent}${unit}` : indent;
  return {
    replaceFromCol: fromCol,
    replaceToCol: toCol + leadingAfterSpaces,
    insert: `\n${nextPrefix}`,
    cursorOffset: 1 + nextPrefix.length,
  };
}
