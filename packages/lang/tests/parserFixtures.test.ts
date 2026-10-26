/**
 * Parser fixture notebook driver (spec: wayfinder test-validation-harness
 * asset 001). Discovers `tests/fixtures/parser/*.md` — one file = one test,
 * zero TS changes to add a case — parses the script through `parseScript`
 * with the fixture's options, and compares positionally against the
 * Expected blocks (or asserts the Errors list).
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseScript } from '../src/index';
import { parseFixtureFile } from './harness/parserFixture/fixtureFile';
import { compareStatement } from '../src/parser-fixture/compare';

const FIXTURE_DIR = join(__dirname, 'fixtures/parser');
const FILES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.md'));

describe('parser fixture catalog', () => {
  if (FILES.length === 0) {
    it.skip('no fixtures discovered', () => {});
    return;
  }

  describe.each(FILES)('%s', (file) => {
    const raw = readFileSync(join(FIXTURE_DIR, file), 'utf-8');
    const fixture = parseFixtureFile(raw, `fixtures/parser/${file}`);

    it(fixture.title, () => {
      const options = {
        ...(fixture.options.sport ? { sport: fixture.options.sport } : {}),
        ...(fixture.options.withoutDialects ? { withoutDialects: true } : {}),
      };
      const script = parseScript(fixture.script, Object.keys(options).length ? options : undefined);

      if (fixture.errors.length > 0) {
        const actual = script.errors.map((e) => `line ${e.line}: "${e.message}"`);
        const expected = fixture.errors.map((e) => `line ${e.line}: "${e.message}"`);
        expect(actual).toEqual(expected);
        return;
      }

      const statements = script.statements;
      // Count is exact whenever an Expected section exists, except the
      // subset-without-blocks escape (spec 001: count unchecked then).
      const countPinned = fixture.hasExpected && (fixture.statements.length > 0 || fixture.match === 'closed');
      if (countPinned) {
        expect(
          statements.length,
          `statement count: fixture expects ${fixture.statements.length}, parse produced ${statements.length} (lines ${statements.map((s) => s.line).join(', ') || 'none'})`,
        ).toBe(fixture.statements.length);
      }

      statements.forEach((statement, index) => {
        const expected = fixture.statements[index];
        if (!expected) return; // subset mode with fewer blocks than statements
        const diffs = compareStatement(expected.metrics, statement.metrics.getAll(), fixture.match);
        for (const diff of diffs) {
          expect.fail(`[Line ${statement.line}] ${diff}`);
        }
      });
    });
  });
});
