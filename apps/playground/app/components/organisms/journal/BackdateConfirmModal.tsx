import React from 'react';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
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
  const formattedDate = formatDateHeader(new Date(`${dateKey}T00:00:00`));

  return (
    <AlertDialog
      open
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && details.reason !== 'action' && !isLoading) onCancel();
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent className="max-w-sm">
        <DialogHeader>
          <AlertDialogTitle>Backdate Journal Entry</AlertDialogTitle>
          <AlertDialogDescription>
            The date you selected ({formattedDate}) is in the past. This will create a journal entry for the selected date.
          </AlertDialogDescription>
        </DialogHeader>
        <DialogFooter>
          <AlertDialogClose disabled={isLoading} onClick={onCancel}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            value="confirm"
            data-variant="solid"
            disabled={isLoading}
            action={() => onConfirm()}
          >
            {isLoading ? 'Importing…' : 'Import'}
          </AlertDialogClose>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
