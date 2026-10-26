/**
 * NotebookList — the notebook plane's management list (ticket 05): every
 * notebook the app knows — the always-present defaults, the user's own, the
 * feed-delivered libraries and the app-owned core references — with the
 * CRUD actions user-owned notebooks allow (edit, delete). Notebooks are
 * landing notes in the notes store; all writes go through NotebookService.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/atoms/primitives/button';
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog';
import { notebookService } from '@/hooks/useBrowserServices';
import type { Notebook } from '@/types/notebook';

export interface NotebookListProps {
    /** Bumped by the host after any notebook-plane write so the list reloads. */
    refreshKey: number;
    /** Called after a successful edit or delete so the host can refresh too. */
    onChanged: () => void;
}

export const NotebookList: React.FC<NotebookListProps> = ({ refreshKey, onChanged }) => {
    const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
    const [editing, setEditing] = useState<Notebook | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void notebookService.getAllCatalogNotebooks()
            .then((all) => {
                if (!cancelled) setNotebooks(all);
            })
            .catch(() => {
                if (!cancelled) setNotebooks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [refreshKey]);

    if (notebooks === null) {
        return <p className="px-6 py-3 text-xs text-muted-foreground" data-testid="notebook-list-loading">Loading notebooks…</p>;
    }

    const handleDelete = async (notebook: Notebook) => {
        try {
            await notebookService.delete(notebook.id);
        } finally {
            setConfirmingDelete(null);
            onChanged();
        }
    };

    return (
        <section className="border-b border-border/60 px-6 py-3" data-testid="notebook-list">
            <ul className="divide-y divide-border/40">
                {notebooks.map((notebook) => {
                    const userOwned = notebook.origin === 'user';
                    return (
                        <li key={notebook.notebookId} className="flex items-center gap-3 py-2" data-testid="notebook-list-row">
                            <span aria-hidden className="text-base">{notebook.icon}</span>
                            <div className="min-w-0 flex-1">
                                <Link
                                    to={`/c/${encodeURIComponent(notebook.slug)}`}
                                    className="text-sm font-medium text-foreground hover:text-primary truncate block"
                                >
                                    {notebook.name}
                                </Link>
                                {notebook.description && (
                                    <p className="text-xs text-muted-foreground truncate">{notebook.description}</p>
                                )}
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                                {notebook.origin === 'feed' ? 'Feed' : notebook.origin === 'default' ? 'App' : 'Yours'}
                            </span>
                            {userOwned && (
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        aria-label={`Edit ${notebook.name}`}
                                        data-testid={`notebook-edit-${notebook.slug}`}
                                        onClick={() => setEditing(notebook)}
                                    >
                                        <Pencil className="size-3.5" />
                                    </Button>
                                    {confirmingDelete === notebook.notebookId ? (
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            title="Notes in this notebook return to the journal"
                                            data-testid={`notebook-delete-confirm-${notebook.slug}`}
                                            onClick={() => void handleDelete(notebook)}
                                        >
                                            Confirm delete
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-8 text-muted-foreground hover:text-destructive"
                                            aria-label={`Delete ${notebook.name}`}
                                            data-testid={`notebook-delete-${notebook.slug}`}
                                            onClick={() => setConfirmingDelete(notebook.notebookId)}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <CreateNotebookDialog
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) setEditing(null);
                }}
                onCreate={async () => null}
                notebook={editing}
                onSave={async (nb, name, description, icon) => {
                    try {
                        const updated = await notebookService.update(nb.id, { name, description, icon });
                        onChanged();
                        return updated;
                    } catch {
                        return null;
                    }
                }}
            />
        </section>
    );
};
