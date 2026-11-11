import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from 'vitest';

type AnyFn = (...args: never[]) => unknown;

function createMock<T extends AnyFn = () => undefined>(impl?: T) {
  return impl ? vi.fn(impl) : vi.fn();
}

export const mock = Object.assign(createMock, {
  restore: () => {
    vi.restoreAllMocks();
  },
  module: () => {
    throw new Error('mock.module is forbidden; use PlaygroundTestHost or injected deps.');
  },
});

export const spyOn = vi.spyOn.bind(vi);
export const jest = vi;

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
};
