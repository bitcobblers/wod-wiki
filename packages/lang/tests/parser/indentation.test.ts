import { describe, expect, it } from 'vitest';
import { computeWhiteboardEnterAction, isRoundsHeaderLine } from '../../src/index';

function applyEnter(lineText: string, fromCol = lineText.length, toCol = fromCol, unit = '  ') {
  const action = computeWhiteboardEnterAction(lineText, fromCol, toCol, unit);
  const nextText = lineText.slice(0, action.replaceFromCol) + action.insert + lineText.slice(action.replaceToCol);
  const cursorCol = action.replaceFromCol + action.cursorOffset;
  return { nextText, cursorCol, action };
}

describe('isRoundsHeaderLine', () => {
  it('recognizes parenthesized, inline, scheme, ladder, and keyword container headers', () => {
    for (const line of [
      '(3)',
      '(3 rounds)',
      '(5 sets)',
      '(4 laps)',
      '(21-15-9)',
      '(21-15-9) FOR TIME',
      '(10) :60 EMOM',
      '(8) :20 Work',
      '(5) :60 #emom // note',
      '3 rounds',
      '5 sets #strength',
      '3 rounds FOR TIME',
      '9-7-5',
      '9-7-5 reps',
      '10:00 AMRAP',
      '12:00 EMOM',
      '4:00 TABATA',
      '5x5',
    ]) {
      expect(isRoundsHeaderLine(line), line).toBe(true);
    }
  });

  it('excludes leaf lines, durations without container keywords, properties, headings, comments, and unclosed parens', () => {
    for (const line of [
      '5x5 Back Squat @100kg',
      '(21-15-9) Thruster',
      '(3) 10 Push-ups',
      '10',
      '10 Air Squats',
      '10:00 Run',
      '(20s)',
      '(10 reps)',
      '* 1:00 Rest',
      'effort: Fran',
      '# Warmup',
      '// comment',
      '(3',
      '',
    ]) {
      expect(isRoundsHeaderLine(line), line).toBe(false);
    }
  });
});

describe('computeWhiteboardEnterAction', () => {
  it('auto-indents after rounds/container headers and preserves nesting level', () => {
    expect(applyEnter('(3)')).toMatchObject({ nextText: '(3)\n  ', cursorCol: 6 });
    expect(applyEnter('  (3)')).toMatchObject({ nextText: '  (3)\n    ', cursorCol: 10 });
    expect(applyEnter('3 rounds')).toMatchObject({ nextText: '3 rounds\n  ', cursorCol: 11 });
    expect(applyEnter('10:00 AMRAP')).toMatchObject({ nextText: '10:00 AMRAP\n  ', cursorCol: 14 });
    expect(applyEnter('9-7-5')).toMatchObject({ nextText: '9-7-5\n  ', cursorCol: 8 });

    // Splitting `(3)| 10 Push-ups` keeps child indented and strips leading space after split.
    expect(applyEnter('(3) 10 Push-ups', 3)).toMatchObject({
      nextText: '(3)\n  10 Push-ups',
      cursorCol: 6,
    });
  });

  it('preserves indentation on regular indented lines and keeps unindented lines at col 0', () => {
    expect(applyEnter('  10 Air Squats')).toMatchObject({ nextText: '  10 Air Squats\n  ', cursorCol: 18 });
    expect(applyEnter('    10 Air Squats')).toMatchObject({ nextText: '    10 Air Squats\n    ', cursorCol: 22 });
    expect(applyEnter('10 Air Squats')).toMatchObject({ nextText: '10 Air Squats\n', cursorCol: 14 });
    expect(applyEnter('10')).toMatchObject({ nextText: '10\n', cursorCol: 3 });
  });

  it('resets indentation to col 0 on blank indented lines (double-Enter) without touching col-0 blank lines', () => {
    const two = applyEnter('  ');
    expect(two).toMatchObject({ nextText: '\n', cursorCol: 1 });
    expect(two.action).toEqual({ replaceFromCol: 0, replaceToCol: 2, insert: '\n', cursorOffset: 1 });

    const four = applyEnter('    ');
    expect(four).toMatchObject({ nextText: '\n', cursorCol: 1 });
    expect(four.action).toEqual({ replaceFromCol: 0, replaceToCol: 4, insert: '\n', cursorOffset: 1 });

    expect(applyEnter('')).toMatchObject({ nextText: '\n', cursorCol: 1 });
  });

  it('auto-continues + and - lap markers and resets cleanly on empty marker lines', () => {
    expect(applyEnter('+ 5 Pull-ups')).toMatchObject({ nextText: '+ 5 Pull-ups\n+ ', cursorCol: 15 });
    expect(applyEnter('  + 5 Pull-ups')).toMatchObject({ nextText: '  + 5 Pull-ups\n  + ', cursorCol: 19 });
    expect(applyEnter('- 10 Air Squats')).toMatchObject({ nextText: '- 10 Air Squats\n- ', cursorCol: 18 });
    expect(applyEnter('  - 10 Air Squats')).toMatchObject({ nextText: '  - 10 Air Squats\n  - ', cursorCol: 22 });

    for (const emptyMarker of ['  + ', '  - ', '+ ', '- ']) {
      const res = applyEnter(emptyMarker);
      expect(res.nextText, emptyMarker).toBe('\n');
      expect(res.cursorCol, emptyMarker).toBe(1);
    }
  });

  it('indents child lines beneath a rounds header prefixed with a lap marker without copying the marker', () => {
    expect(applyEnter('- (3)')).toMatchObject({ nextText: '- (3)\n  ', cursorCol: 8 });
    expect(applyEnter('  + (3)')).toMatchObject({ nextText: '  + (3)\n    ', cursorCol: 12 });
    expect(applyEnter('  - 3 rounds')).toMatchObject({ nextText: '  - 3 rounds\n    ', cursorCol: 17 });
  });

  it('cleans leading whitespace above when pressing Enter before or inside leading indent', () => {
    expect(applyEnter('  10 Pull-ups', 0)).toMatchObject({ nextText: '\n  10 Pull-ups', cursorCol: 1 });
    expect(applyEnter('  10 Pull-ups', 2)).toMatchObject({ nextText: '\n  10 Pull-ups', cursorCol: 3 });
  });
});
