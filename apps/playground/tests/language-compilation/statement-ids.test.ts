// Test to verify statement IDs are stable structural identifiers (document-order
// ordinals), while physical source location lives in `meta.line` / `line`.
import { describe, it, expect, beforeEach } from 'bun:test';
import { MdTimerRuntime } from '@bitcobblers/wod-wiki-engine';

describe('Statement ID Line Number Verification', () => {
  let runtime: MdTimerRuntime;

  beforeEach(() => {
    runtime = new MdTimerRuntime();
  });

  it('should assign unique document-order IDs to statements', () => {
    const input = `first statement
second statement
third statement`;

    const result = runtime.read(input);

    // Verify we have 3 statements
    expect(result.statements.length).toBe(3);

    // IDs are unique and ascend in document order (structural identity)
    const ids = result.statements.map(s => s.id);
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('should link nested statements by ID, not line number', () => {
    const input = `parent
  child 1
  child 2`;

    const result = runtime.read(input);

    const parent = result.statements.find(stmt => stmt.meta.line === 1);
    expect(parent).toBeDefined();
    expect(parent!.children).toBeDefined();

    // Children are referenced through the parent's child ID groups
    const allChildIds = parent!.children.flat();
    expect(allChildIds).toHaveLength(2);
    for (const childId of allChildIds) {
      const child = result.statements.find(stmt => stmt.id === childId);
      expect(child).toBeDefined();
      expect(child!.parent).toBe(parent!.id);
    }
  });

  it('should maintain IDs and line numbers across complex structures', () => {
    const input = `line one
line two
line three
line four
line five`;

    const result = runtime.read(input);

    // IDs stay unique in document order; physical line lives on meta.line
    result.statements.forEach((stmt, index) => {
      expect(stmt.id).not.toBeNaN();
      expect(stmt.meta.line).toBe(index + 1);
    });
    const ids = result.statements.map(s => s.id);
    expect(new Set(ids).size).toBe(result.statements.length);
  });

  it('should keep IDs independent of character offsets', () => {
    // This input has specific character offsets we can predict
    const input = `statement one
statement two
statement three`;

    const result = runtime.read(input);

    // Line 1 starts at offset 0
    // Line 2 starts at offset 14 (after "statement one\n")
    // Line 3 starts at offset 28 (after "statement one\nstatement two\n")

    // Each statement reports its 1-based line number via meta.line
    expect(result.statements[0].meta.line).toBe(1);
    expect(result.statements[1].meta.line).toBe(2);
    expect(result.statements[2].meta.line).toBe(3);

    // IDs are structural ordinals, not character offsets (would be 0, 14, 28)
    // id 0 legitimately coincides with the first statement's offset 0; later
    // statements must diverge, and ids never equal line numbers.
    expect(result.statements[1].id).not.toBe(result.statements[1].meta.startOffset);
    expect(result.statements[2].id).not.toBe(result.statements[2].meta.startOffset);
    result.statements.forEach((stmt, i) => {
      expect(stmt.id).not.toBe(stmt.meta.line);
      if (i > 0) expect(stmt.id).toBeLessThan(stmt.meta.startOffset);
    });
  });
});
