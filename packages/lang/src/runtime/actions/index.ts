/**
 * Runtime Actions - Declarative action types for behavior orchestration
 * 
 * This module exports all action types that can be returned from behaviors
 * to perform operations in a declarative manner.
 */

// Stack actions
export * from './stack';

// Event actions
export * from './events';

// Error actions
export { ErrorAction } from './ErrorAction';
export { ThrowError, ThrowErrorAction } from './ThrowError';
export type { RuntimeError } from './ErrorAction';
