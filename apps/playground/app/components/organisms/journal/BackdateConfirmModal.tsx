import React from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { formatDateHeader } from '@/lib/dateFormat';

export interface BackdateConfirmModalProps {
  dateKey: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export const BackdateConfirmModal: React.FC<BackdateConfirmModalProps> = ({
  dateKey,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [confirming, setConfirming] = React.useState(false);

  const date = new Date(`${dateKey}T00:00:00`);
  const formattedDate = formatDateHeader(date);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  const disabled = confirming || isLoading;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !disabled) onCancel();
      }}
    >
      <DialogBackdrop className="bg-black/50" />
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-background rounded-lg border border-border shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <DialogTitle className="text-base font-semibold">Backdate Journal Entry</DialogTitle>
          <DialogClose
            aria-label="Close modal"
            disabled={disabled}
            className="p-1 h-auto w-auto border-0 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="px-6 py-4 space-y-4">
          <DialogDescription className="text-sm text-muted-foreground">
            The date you selected is in the past.
          </DialogDescription>
          <p className="text-sm">
            <span className="text-muted-foreground">Import to: </span>
            <span className="font-medium text-foreground">{formattedDate}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            This will create a journal entry for the selected date. Are you sure you want to proceed?
          </p>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={disabled}>
            {disabled ? 'Importing...' : 'Import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
