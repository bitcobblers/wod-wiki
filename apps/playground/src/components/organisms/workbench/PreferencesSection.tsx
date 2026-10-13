import React, { useState } from 'react';
import { Sun, Moon, Volume2, VolumeX, Bug, GitFork, Settings, Download, Upload, ExternalLink } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeProvider';
import { useAudio } from '@/contexts/AudioContext';
import { useDebugMode } from '@/contexts/DebugModeContext';
import { cn } from '@/lib/utils';
import type { IContentProvider } from '@/types/content-provider';
import { exportAllNotes, importFromZip, pickFile } from '@/hooks/useWorkbenchServices';

interface PreferencesSectionProps {
  provider?: IContentProvider;
}

export const PreferencesSection: React.FC<PreferencesSectionProps> = ({ provider }) => {
  const { setTheme, theme } = useTheme();
  const { isEnabled: isAudioEnabled, toggleAudio } = useAudio();
  const { isDebugMode, toggleDebugMode } = useDebugMode();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const toggleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      setTheme(sys === 'dark' ? 'light' : 'dark');
    }
  };

  const handleExportAll = async () => {
    if (!provider) return;
    setIsExporting(true);
    try {
      await exportAllNotes(provider);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!provider) return;
    setIsImporting(true);
    try {
      const file = await pickFile('.zip');
      if (!file) {
        setIsImporting(false);
        return;
      }

      const result = await importFromZip(file, provider);

      if (result.errors.length > 0) {
        alert(`Import completed with errors:\n${result.imported} notes imported\n\nErrors:\n${result.errors.join('\n')}`);
      } else {
        alert(`Successfully imported ${result.imported} notes!`);
      }

      window.location.reload();
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Settings className="w-3.5 h-3.5 text-muted-foreground" />
        <label className="text-xs font-medium text-muted-foreground">Preferences</label>
      </div>
      <div className="space-y-0.5">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
        >
          {isDark ? (
            <Moon className="w-4 h-4 shrink-0" />
          ) : (
            <Sun className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">Theme</span>
          <span className="text-xs text-muted-foreground capitalize">{theme}</span>
        </button>

        <button
          onClick={toggleAudio}
          className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
        >
          {isAudioEnabled ? (
            <Volume2 className="w-4 h-4 shrink-0" />
          ) : (
            <VolumeX className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">Sound</span>
          <span className="text-xs text-muted-foreground">{isAudioEnabled ? 'On' : 'Off'}</span>
        </button>

        {import.meta.env.DEV && (
          <button
            onClick={toggleDebugMode}
            className={cn(
              'flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm transition-colors text-left',
              isDebugMode
                ? 'text-foreground bg-muted'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Bug className="w-4 h-4 shrink-0" />
            <span className="flex-1">Debug Mode</span>
            {isDebugMode && <span className="w-2 h-2 rounded-full bg-signal-positive animate-pulse shrink-0" />}
            <span className="text-xs text-muted-foreground">{isDebugMode ? 'On' : 'Off'}</span>
          </button>
        )}

        {provider && (
          <>
            <div className="h-px bg-border my-2" />

            <button
              onClick={handleExportAll}
              disabled={isExporting}
              className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span className="flex-1">{isExporting ? 'Exporting...' : 'Export All Data'}</span>
            </button>

            <button
              onClick={handleImport}
              disabled={isImporting}
              className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span className="flex-1">{isImporting ? 'Importing...' : 'Import Data'}</span>
            </button>
          </>
        )}

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
      </div>
    </div>
  );
};
