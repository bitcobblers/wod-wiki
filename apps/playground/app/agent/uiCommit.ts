import { getSurfaceBusy } from '@/agent/surfaceBridges';

/**
 * Wait for React commit + browser layout/paint (double requestAnimationFrame).
 * Falls back cleanly in non-browser / headless timer environments.
 */
export async function waitForUiCommit(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return;
  }
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Wait until async stream/explorer execution settles (`getSurfaceBusy() === false`)
 * up to `timeoutMs`, then flush a UI commit frame.
 */
export async function waitForStreamSettle(timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Allow React effect & 150ms debounce to kick off first
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  while (getSurfaceBusy() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  await waitForUiCommit();
}
