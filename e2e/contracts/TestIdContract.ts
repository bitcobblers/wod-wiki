/**
 * Re-exports the canonical TestIdContract from src/lib/testIds so that
 * e2e test files import from this path rather than crossing into app code.
 *
 * Import in e2e tests:
 *   import { TEST_IDS } from '../contracts/TestIdContract';
 */
export { TEST_IDS } from '../../apps/playground/src/lib/testIds';
export type { TestId } from '../../apps/playground/src/lib/testIds';
