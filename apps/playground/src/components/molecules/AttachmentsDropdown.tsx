import React from 'react';
import { Upload, Trash2, File } from 'lucide-react';
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Separator,
} from '@bitcobblers/wod-wiki-ui/primitives';
import type { Attachment } from '@/types/storage';
import { formatDateMedium } from '@/lib/dateFormat';

interface AttachmentsDropdownProps {
  attachments: Attachment[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownload: (att: Attachment) => void;
  onDelete: (id: string) => void;
}

export const AttachmentsDropdown: React.FC<AttachmentsDropdownProps> = ({
  attachments,
  fileInputRef,
  onFileSelect,
  onDownload,
  onDelete,
}) => {
  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={onFileSelect}
        multiple
      />
      <Popover>
        <div className="relative inline-flex">
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Attachments"
                title="Attachments"
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            <Upload className="h-5 w-5" aria-hidden="true" />
          </PopoverTrigger>
          {attachments.length > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center p-0 text-[10px] bg-primary text-primary-foreground pointer-events-none">
              {attachments.length}
            </Badge>
          )}
        </div>
        <PopoverContent align="end" sideOffset={6} className="w-64 p-2 space-y-2">
          <div className="flex justify-between items-center px-2 py-1">
            <PopoverTitle className="text-xs font-semibold">Attachments</PopoverTitle>
            <Badge variant="outline">{attachments.length}</Badge>
          </div>
          <Separator />

          {attachments.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No attachments found
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex flex-col items-start gap-1 p-2 rounded-md hover:bg-muted/60"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:underline text-left"
                      onClick={() => onDownload(att)}
                    >
                      <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate text-sm font-medium">{att.label}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${att.label}`}
                      data-agent-confirm={`Deletes attachment "${att.label}"`}
                      className="h-7 w-7 min-h-7 min-w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(att.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex w-full justify-between text-[10px] text-muted-foreground px-6">
                    <span>{att.mimeType.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                    <span>{formatDateMedium(new Date(att.createdAt))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-primary font-medium"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
            Upload New
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
};
