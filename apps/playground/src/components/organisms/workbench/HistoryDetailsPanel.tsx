import React from 'react';
import { FolderOpen, Settings, Sun, Moon, Volume2, VolumeX, GitFork, ExternalLink } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeProvider';
import { useAudio } from '@/contexts/AudioContext';
import { cn } from '@/lib/utils';
import type { ScriptCollection } from '@/repositories/script-collections';

export interface HistoryDetailsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    /** WOD Collections */
    collections: ScriptCollection[];
    activeCollectionId: string | null;
    onCollectionSelect: (id: string | null) => void;
    /** Clear notebook when selecting a collection */
    onNotebookClear?: () => void;
}

export const HistoryDetailsPanel: React.FC<HistoryDetailsPanelProps> = ({
    isOpen,
    onClose,
    collections,
    activeCollectionId,
    onCollectionSelect,
    onNotebookClear,
}) => {
    return (
        <div
            className={cn(
                "absolute top-0 right-0 h-full w-80 bg-background border-l border-border shadow-xl z-20 transition-transform duration-300 ease-in-out transform",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}
        >
            <div className="flex flex-col h-full">
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* Collections Section */}
                    {collections.length > 0 && (
                        <div>
                            <div className="flex items-center gap-1.5 mb-2">
                                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Collections</label>
                            </div>
                            <div className="space-y-0.5">
                                {collections.map(col => (
                                    <button
                                        key={col.id}
                                        onClick={() => {
                                            onCollectionSelect(activeCollectionId === col.id ? null : col.id);
                                            if (activeCollectionId !== col.id) {
                                                onNotebookClear?.();
                                            }
                                            onClose();
                                        }}
                                        className={cn(
                                            "w-full text-left text-sm px-2 py-1.5 rounded transition-colors flex items-center gap-2",
                                            activeCollectionId === col.id
                                                ? "bg-accent text-accent-foreground font-medium"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        )}
                                    >
                                        <FolderOpen className="h-3 w-3 shrink-0" />
                                        <span className="truncate flex-1">{col.name}</span>
                                        <span className="text-[10px] text-muted-foreground tabular-nums">{col.count}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Preferences */}
                    <PreferencesSection />

                    {/* Links */}
                    <LinksSection />
                </div>
            </div>
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// Preferences Section
// ──────────────────────────────────────────────────────────────

const PreferencesSection: React.FC = () => {
    const { setTheme, theme } = useTheme();
    const { isEnabled: isAudioEnabled, toggleAudio } = useAudio();

    const toggleTheme = () => {
        if (theme === 'dark') setTheme('light');
        else if (theme === 'light') setTheme('dark');
        else {
            const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            setTheme(sys === 'dark' ? 'light' : 'dark');
        }
    };

    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    return (
        <div>
            <div className="flex items-center gap-1.5 mb-1">
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preferences</label>
            </div>
            <div className="space-y-0.5">
                <button
                    onClick={toggleTheme}
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                >
                    {isDark
                        ? <Moon className="w-4 h-4 shrink-0" />
                        : <Sun className="w-4 h-4 shrink-0" />
                    }
                    <span className="flex-1">Theme</span>
                    <span className="text-xs text-muted-foreground capitalize">{theme}</span>
                </button>

                <button
                    onClick={toggleAudio}
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                >
                    {isAudioEnabled
                        ? <Volume2 className="w-4 h-4 shrink-0" />
                        : <VolumeX className="w-4 h-4 shrink-0" />
                    }
                    <span className="flex-1">Sound</span>
                    <span className="text-xs text-muted-foreground">{isAudioEnabled ? 'On' : 'Off'}</span>
                </button>


            </div>
        </div>
    );
};

// ──────────────────────────────────────────────────────────────
// Links Section
// ──────────────────────────────────────────────────────────────

const LinksSection: React.FC = () => {
    return (
        <div>
            <div className="flex items-center gap-1.5 mb-1">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Links</label>
            </div>
            <div className="space-y-0.5">
                <a
                    href="https://github.com/bitcobblers/wod-wiki"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                >
                    <GitFork className="w-4 h-4 shrink-0" />
                    <span className="flex-1">GitHub</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                </a>
                <a
                    href="https://github.com/bitcobblers/wod-wiki/wiki"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                >
                    <ExternalLink className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Documentation</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                </a>
            </div>
        </div>
    );
};
