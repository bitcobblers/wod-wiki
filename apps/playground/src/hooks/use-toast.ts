import {
  notifyToast,
  useToast as usePrimitiveToast,
  type ToastNotificationInput,
} from '@bitcobblers/wod-wiki-ui/primitives';

export function toast(input: ToastNotificationInput) {
  return notifyToast(input);
}

export function useToast() {
  return usePrimitiveToast();
}

export type { ToastNotificationInput as Toast };
