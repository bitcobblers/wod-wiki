export interface Command {
  id: string;
  label: string;
  action: () => void;
  shortcut?: string[];
  context?: string; // 'global', 'editor', 'timer', etc.
  group?: string;
  keywords?: string[];
}
