import { describe, it, expect } from 'vitest';
import * as tools from '../src/index';

describe('@bitcobblers/wod-wiki-tools exports', () => {
  it('exports CLI runners, formatters, and subcommands', () => {
    expect(tools.runParse).toBeDefined();
    expect(tools.runExecution).toBeDefined();
    expect(tools.runQueryCli).toBeDefined();
    expect(tools.loadLanguagePack).toBeDefined();
    expect(tools.formatParseOutput).toBeDefined();
    expect(tools.formatExecutionOutput).toBeDefined();
    expect(tools.formatQueryOutput).toBeDefined();
    expect(tools.cliMain).toBeDefined();
    expect(tools.parseCliArgs).toBeDefined();
    expect(tools.openCliDb).toBeDefined();
    expect(tools.loadCliEnvironment).toBeDefined();
    expect(tools.runCliServer).toBeDefined();
  });
});
