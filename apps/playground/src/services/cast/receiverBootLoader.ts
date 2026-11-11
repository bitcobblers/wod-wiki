export const RECEIVER_BOOT_READY_TIMEOUT_MS = 12000;
export const RECEIVER_BOOT_FADE_MS = 500;
export const RECEIVER_BOOT_DEGRADED_STATUS = 'waiting-for-cast (degraded)';
export const RECEIVER_BOOT_STANDALONE_STATUS = 'waiting-for-cast (standalone)';
export const RECEIVER_BOOT_START_FAILURE_STATUS = 'waiting-for-cast (start-failure)';

export type BootLoaderDismissReason = 'ready' | 'timeout' | 'error' | 'standalone' | 'no-caf' | 'start-failure';

export interface ReceiverWaitingScreenCopy {
  title: string;
  description: string;
  isError: boolean;
}

/**
 * Dismiss the initial boot overlay with the same fade the HTML shell uses.
 * Returns false when the overlay is already gone or never mounted.
 */
export function dismissReceiverBootLoader(
  reason: BootLoaderDismissReason,
  fadeMs: number = RECEIVER_BOOT_FADE_MS,
): boolean {
  const loader = document.getElementById('initial-loader');
  if (!loader || Boolean(loader.dataset.bootDismissed)) {
    return false;
  }

  loader.dataset.bootDismissed = reason;
  loader.style.opacity = '0';

  window.setTimeout(() => {
    loader.style.display = 'none';
  }, fadeMs);

  return true;
}

/**
 * Arm the fallback that recovers from a missing CAF READY event.
 */
export function armReceiverBootFallback(
  onTimeout: () => void,
  timeoutMs: number = RECEIVER_BOOT_READY_TIMEOUT_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(onTimeout, timeoutMs);
}

export function receiverStandaloneModeEnabled(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const receiverMode = (params.get('receiverMode') || '').toLowerCase();
  const standalone = (params.get('standalone') || '').toLowerCase();

  return receiverMode === 'standalone' || standalone === '1' || standalone === 'true';
}

export function getReceiverWaitingScreenCopy(status: string): ReceiverWaitingScreenCopy {
  if (status === RECEIVER_BOOT_STANDALONE_STATUS) {
    return {
      title: 'Standalone receiver mode',
      description: 'Receiver UI is running without CAF so you can test the waiting shell in a normal browser.',
      isError: false,
    };
  }

  if (status === RECEIVER_BOOT_DEGRADED_STATUS) {
    return {
      title: 'Ready for cast',
      description: 'CAF is unavailable, so the receiver is showing its fallback waiting shell instead of a blank loader.',
      isError: false,
    };
  }

  if (status === RECEIVER_BOOT_START_FAILURE_STATUS || status === 'error') {
    return {
      title: 'Receiver fallback mode',
      description: 'Receiver startup failed, but the waiting shell is still available for browser testing and recovery.',
      isError: true,
    };
  }

  return {
    title: 'Ready for cast',
    description: 'Open Cast on the sender to connect this screen.',
    isError: false,
  };
}
