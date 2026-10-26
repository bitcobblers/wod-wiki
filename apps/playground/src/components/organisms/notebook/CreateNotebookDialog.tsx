/**
 * CreateNotebookDialog — Modal for creating a new notebook.
 *
 * Fields: name (required), description (optional), icon (emoji picker grid).
 */

import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/atoms/Dialog';
import { Button } from '@/components/atoms/primitives/button';
import { cn } from '@/lib/utils';
import type { Notebook } from '@/types/notebook';

/** Icon choices the notebook picker offers. */
const ICONS = ['📓', '🏋️', '🔥', '💪', '⭐', '🎯', '🏃', '🧘', '🥊', '🚴'];

interface CreateNotebookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Failure returns null and leaves the draft open. */
    onCreate: (name: string, description: string, icon: string) => Promise<Notebook | null>;
    /** Edit mode: the notebook being renamed/redescribed/re-iconed, and the
     *  save callback (same null-on-failure contract as onCreate). */
    notebook?: Notebook | null;
    onSave?: (notebook: Notebook, name: string, description: string, icon: string) => Promise<Notebook | null>;
}

export const CreateNotebookDialog: React.FC<CreateNotebookDialogProps> = ({
    open,
    onOpenChange,
    onCreate,
    notebook,
    onSave,
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [selectedIcon, setSelectedIcon] = useState('📓');
    const [saving, setSaving] = useState(false);
    const editing = !!notebook;

    // Fresh fields from the notebook on every open.
    React.useEffect(() => {
        if (!open) return;
        setName(notebook?.name ?? '');
        setDescription(notebook?.description ?? '');
        setSelectedIcon(notebook?.icon ?? '📓');
    }, [open, notebook]);

    const handleSubmit = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
            const trimmed = name.trim();
            const next = editing && notebook && onSave
                ? await onSave(notebook, trimmed, description.trim(), selectedIcon)
                : await onCreate(trimmed, description.trim(), selectedIcon);
            if (!next) return;
            if (!editing) {
                setName('');
                setDescription('');
                setSelectedIcon('📓');
            }
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && name.trim()) {
            e.preventDefault();
            void handleSubmit();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-popover text-popover-foreground border border-border">
                <DialogHeader>
                    <DialogTitle className="text-foreground">{editing ? 'Edit Notebook' : 'Create Notebook'}</DialogTitle>
                    <DialogDescription>
                        {editing ? 'Rename, describe or re-icon this notebook.' : 'Organize your sessions into collections.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    {/* Icon Picker */}
                    <div>
                        <label className="text-sm font-medium text-foreground/80 mb-2 block">
                            Icon
                        </label>
                        <div className="flex flex-wrap gap-1">
                            {ICONS.map(icon => (
                                <button
                                    key={icon}
                                    type="button"
                                    onClick={() => setSelectedIcon(icon)}
                                    className={cn(
                                        'w-9 h-9 rounded-md flex items-center justify-center text-lg transition-all',
                                        'hover:bg-accent hover:scale-110',
                                        selectedIcon === icon
                                            ? 'bg-primary/20 ring-2 ring-primary scale-110'
                                            : 'bg-muted/50'
                                    )}
                                >
                                    {icon}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-sm font-medium text-foreground/80 mb-1 block">
                            Name <span className="text-destructive">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g., Morning Routines"
                            autoFocus
                            className={cn(
                                'w-full px-3 py-2 rounded-md text-sm',
                                'bg-background border border-border',
                                'text-foreground placeholder:text-muted-foreground',
                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                'transition-colors'
                            )}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="text-sm font-medium text-foreground/80 mb-1 block">
                            Description <span className="text-muted-foreground text-xs">(optional)</span>
                        </label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="A brief description of this notebook..."
                            rows={2}
                            className={cn(
                                'w-full px-3 py-2 rounded-md text-sm resize-none',
                                'bg-background border border-border',
                                'text-foreground placeholder:text-muted-foreground',
                                'focus:outline-none focus:ring-2 focus:ring-primary/50',
                                'transition-colors'
                            )}
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={() => void handleSubmit()}
                            disabled={!name.trim() || saving}
                        >
                            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
