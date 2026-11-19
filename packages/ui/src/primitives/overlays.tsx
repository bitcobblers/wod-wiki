"use client";

import { OverlayHost, type OverlayHostProps } from '@ui-sdk/react/overlays';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
  toast as uiToast,
  type ToastActionData,
  type ToastOptions,
} from '@ui-sdk/react/toast';
import type * as React from 'react';

export interface ToastNotificationInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive' | 'success';
  action?: ToastActionData<React.ReactNode>;
  duration?: number;
}

export function notifyToast(input: ToastNotificationInput): { id: string; dismiss: () => void } {
  const title = input.title ?? '';
  const options: ToastOptions<React.ReactNode> = {
    description: input.description,
    action: input.action,
    duration: input.duration,
  };
  const id =
    input.variant === 'destructive'
      ? uiToast.error(title, options)
      : input.variant === 'success'
        ? uiToast.success(title, options)
        : uiToast(title, options);

  return {
    id,
    dismiss: () => uiToast.dismiss(id),
  };
}

export function useToast(): {
  toast: typeof notifyToast;
  dismiss: (toastId?: string) => void;
} {
  return {
    toast: notifyToast,
    dismiss: (toastId?: string) => uiToast.dismiss(toastId),
  };
}

export function WodOverlayHost(props: Omit<OverlayHostProps, 'toast'>): React.JSX.Element {
  return (
    <div className="contents" data-agent-hidden="">
      <OverlayHost
        {...props}
        toast={{
          children: () => (
            <Toast className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg data-[type=error]:border-destructive/60">
              <div className="min-w-0 flex-1 space-y-1">
                <ToastTitle className="text-sm font-semibold text-foreground" />
                <ToastDescription className="text-xs text-muted-foreground whitespace-pre-line" />
              </div>
              <ToastAction data-variant="solid" />
              <ToastClose aria-label="Close notification" />
            </Toast>
          ),
        }}
      />
    </div>
  );
}

export {
  OverlayHost,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
  uiToast as toast,
};
export type { OverlayHostProps, ToastActionData, ToastOptions };
