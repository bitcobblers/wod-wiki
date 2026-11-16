import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/primitives/dropdown-menu'
import type { NoteHelpfulAction } from './useNotePageNav'

export interface NoteCardActionsProps {
  noteId: string
  noteTitle?: string
  actions: NoteHelpfulAction[]
}

/**
 * Per-note overflow action menu (`MoreVertical`) used on multi-surface views
 * such as `/day/:date` so each note card exposes Delete, Clone, Export,
 * Notebooks & Promotion, Placements, Copy link, and Add timer.
 */
export function NoteCardActions({ noteId, noteTitle, actions }: NoteCardActionsProps) {
  const [open, setOpen] = useState(false)
  if (actions.length === 0) return null

  const label = noteTitle ? `Note options for ${noteTitle}` : 'Note options'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={label}
          title="Note options"
          data-testid={`note-card-options-${noteId}`}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled}
              data-testid={action.testId ? `card-${action.testId}-${noteId}` : undefined}
              className={action.id === 'delete-note' ? 'text-destructive focus:text-destructive' : undefined}
              onClick={() => {
                setOpen(false)
                action.onRun()
              }}
            >
              {Icon && <Icon className="mr-2 size-4" aria-hidden="true" />}
              <span>{action.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
