import React from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { X } from 'lucide-react';
import { TEST_IDS } from '@/lib/testIds';

export interface FocusedDialogProps {
  title?: string;
  ariaLabel?: string;
  onClose: () => void;
  children: React.ReactNode;
  closeButtonClassName?: string;
  floatingClose?: boolean;
  variant?: 'default' | 'minimal';
  actions?: React.ReactNode;
  closeLabel?: string;
}

export const FocusedDialog: React.FC<FocusedDialogProps> = ({
  title,
  ariaLabel,
  onClose,
  children,
  closeButtonClassName,
  floatingClose = false,
  variant = 'default',
  actions,
  closeLabel,
}) => {
  const isMinimal = variant === 'minimal';

  const closeBtn = (
    <DialogClose
      aria-label={closeLabel ? undefined : 'Close'}
      title={closeLabel ?? 'Close'}
      data-testid={TEST_IDS.FOCUSED_DIALOG_CLOSE}
      className={
        closeButtonClassName ??
        `rounded-pill border-0 transition-colors shadow-[rgba(0,0,0,0.06)_0px_1px_2px] ${isMinimal ? 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground' : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'} ${
          closeLabel ? 'flex h-11 min-w-[44px] items-center justify-center px-4 text-sm font-medium hover:text-foreground' : 'p-2 h-auto w-auto'
        }`
      }
    >
      {closeLabel ?? <X className="h-5 w-5" aria-hidden="true" />}
    </DialogClose>
  );

  return (
    <Dialog
      open
      dismissible={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        initialFocus="content"
        aria-label={ariaLabel ?? title ?? 'Workout'}
        className="fixed inset-0 z-[100] m-0 w-screen max-w-none h-dvh max-h-none p-0 gap-0 rounded-none border-0 shadow-none flex flex-col bg-background text-foreground outline-none"
      >
        {floatingClose || (isMinimal && !title) ? (
          <>
            {title && <DialogTitle className="sr-only">{title}</DialogTitle>}
            <div className="absolute top-4 right-4 z-[110] flex items-center gap-2">
              {actions}
              {closeBtn}
            </div>
          </>
        ) : title ? (
          <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${isMinimal ? 'bg-muted/10' : 'bg-muted/30'} shrink-0`}>
            <DialogTitle className={`text-lg ${isMinimal ? 'font-black tracking-tight uppercase text-[11px] text-muted-foreground' : 'font-semibold'}`}>
              {title}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {actions}
              {closeBtn}
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
};
