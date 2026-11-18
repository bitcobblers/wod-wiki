"use client";

import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface EditorDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  presentation?: 'default' | 'sheet';
}

export function EditorDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  presentation = 'default',
}: EditorDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sheet = presentation === 'sheet';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      presentation={sheet ? 'auto' : undefined}
    >
      <DialogBackdrop className="bg-black/40 dark:bg-black/60 sm:backdrop-blur-sm" />
      <DialogContent
        ref={panelRef}
        initialFocus={() => {
          if (sheet) return panelRef.current;
          return panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panelRef.current;
        }}
        className={cn(
          'gap-0 p-0 flex min-h-0 w-full flex-col overflow-hidden bg-card text-foreground border border-border shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:rounded-xl',
          sheet
            ? 'max-sm:min-h-[66dvh] max-sm:max-h-[92dvh] max-sm:w-screen max-sm:rounded-t-2xl max-sm:rounded-b-none'
            : 'max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0',
        )}
      >
        {sheet && (
          <div aria-hidden="true" className="flex justify-center pt-2 sm:hidden">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        <div className="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </div>
          <DialogClose
            aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-9"
          >
            <X className="size-5 sm:size-4" aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 border-t border-border/80 bg-muted/10 px-4 py-3 sm:px-6',
              sheet
                ? 'max-sm:[&_button]:min-h-12 max-sm:[&_button]:min-w-11 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                : 'max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11',
            )}
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
