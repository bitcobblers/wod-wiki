import { MdTimerRuntime } from './md-timer';
import type { ParserConfig } from './md-timer';

/**
 * Create a parser instance. Pass `{ references: createReferenceIndex(catalog), defaults }`
 * to resolve canonical effort/equipment refs at parse time.
 */
export function createParser(config?: ParserConfig): MdTimerRuntime {
  return new MdTimerRuntime(config);
}
