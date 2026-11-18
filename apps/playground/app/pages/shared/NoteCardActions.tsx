import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import type { NoteHelpfulAction } from './useNotePageNav';

export interface NoteCardActionsProps {
  noteId: string;
  noteTitle?: string;
  actions: NoteHelpfulAction[];
}

export function NoteCardActions({ noteId, noteTitle, actions }: NoteCardActionsProps) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  const label = noteTitle ? `Note options for ${noteTitle}` : 'Note options';

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 min-h-7 min-w-7 text-muted-foreground hover:text-foreground"
              aria-label={label}
              title="Note options"
              data-testid={`note-card-options-${noteId}`}
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end" sideOffset={6} className="w-56">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <MenuItem
                key={action.id}
                value={action.id}
                disabled={action.disabled}
                data-testid={action.testId ? `card-${action.testId}-${noteId}` : undefined}
                className={action.id === 'delete-note' ? 'text-destructive data-highlighted:text-destructive' : undefined}
                onClick={() => {
                  setOpen(false);
                  action.onRun();
                }}
              >
                {Icon && <Icon className="mr-2 size-4" aria-hidden="true" />}
                <span>{action.label}</span>
              </MenuItem>
            );
          })}
        </MenuContent>
      </Menu>
    </div>
  );
}
