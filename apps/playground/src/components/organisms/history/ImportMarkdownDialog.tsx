import React, { useState } from 'react';
import {
    Button,
    Dialog,
    DialogBackdrop,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';

interface ImportMarkdownDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onImport: (markdown: string) => Promise<void>;
}

export const ImportMarkdownDialog: React.FC<ImportMarkdownDialogProps> = ({
    open,
    onOpenChange,
    onImport,
}) => {
    const [markdown, setMarkdown] = useState('');
    const [isImporting, setIsImporting] = useState(false);

    const handleImport = async () => {
        if (!markdown.trim()) return;

        setIsImporting(true);
        try {
            await onImport(markdown);
            setMarkdown('');
            onOpenChange(false);
        } catch (error) {
            console.error('Import failed:', error);
            alert('Failed to import markdown');
        } finally {
            setIsImporting(false);
        }
    };

    const handleCancel = () => {
        setMarkdown('');
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogBackdrop />
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Import from Markdown</DialogTitle>
                    <DialogDescription>
                        Paste your markdown content below to create a new note
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0">
                    <textarea
                        value={markdown}
                        onChange={(e) => setMarkdown(e.target.value)}
                        placeholder="Paste your markdown content here..."
                        className="w-full h-full min-h-[300px] p-3 rounded-md border border-border bg-background text-foreground font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={isImporting}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleImport}
                        disabled={!markdown.trim() || isImporting}
                    >
                        {isImporting ? 'Importing...' : 'Import'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
