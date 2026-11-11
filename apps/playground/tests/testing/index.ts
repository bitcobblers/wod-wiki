// Test harnesses
export * from './harness';

// Setup actions
export * from './setup';

// Test components
export * from './components';

// Shared test contracts
export * from '@/lib/testIds';
export type { RuntimeSnapshot, SnapshotDiff } from './contracts/SnapshotTypes';

// Compiler factory
export { createCompiler, PRODUCTION_STRATEGIES } from './compiler';
