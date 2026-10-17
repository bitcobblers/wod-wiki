import { WhiteboardScript } from './WhiteboardScript';
import { parseScript } from './parseScript';
import type { ReferenceIndex, ReferenceResolutionDefaults } from '../effort-registry/reference-resolution';

/** Parser construction config: shared reference index + note-level defaults. */
export interface ParserConfig {
  references?: ReferenceIndex;
  defaults?: ReferenceResolutionDefaults;
}

/**
 * Headless parser facade using the Lezer parser with 0 DOM / EditorState overhead.
 */
export class MdTimerRuntime {
  private readonly config?: ParserConfig;

  constructor(config?: ParserConfig) {
    this.config = config;
  }

  /**
   * Parse WhiteboardScript source into a {@link WhiteboardScript}, running the
   * Dialect Stack on every statement.
   *
   * @param sport - The block's `:sport` fence suffix (` ```log:climbing `).
   */
  read(inputText: string, sport?: string): WhiteboardScript {
    return parseScript(inputText, { sport, ...this.config });
  }

  /**
   * Parse without running the Dialect Stack. Used by the parser test harness
   * which applies its own Dialect set. Production consumers should use {@link read}.
   */
  readWithoutDialects(inputText: string): WhiteboardScript {
    return parseScript(inputText, { withoutDialects: true, ...this.config });
  }
}
