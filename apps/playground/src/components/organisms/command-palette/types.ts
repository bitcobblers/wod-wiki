export interface Command {
  id: string;
  label: string;
  action: () => void;
  shortcut?: string[];
  context?: string; // 'global', 'editor', 'timer', etc.
  group?: string;
  keywords?: string[];
}

/**
 * @deprecated Use PaletteDataSource from palette-types.ts instead.
 * Kept temporarily for call-sites that have not yet been migrated.
 */
export interface CommandPaletteResult {
  id: string;
  name: string;
  category: string;
  content?: string;
  type?: 'workout' | 'result' | 'action' | 'statement-part' | 'route';
  subtitle?: string;
  payload?: unknown;
}

/**
 * @deprecated Use PaletteDataSource + usePaletteStore.open() instead.
 * Kept temporarily for call-sites that have not yet been migrated.
 */
export interface CommandStrategy {
  id: string;
  placeholder?: string;
  initialInputValue?: string;
  renderHeader?: () => React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy CommandStrategy contract references CommandPaletteResult until removal.
  getResults: (query: string) => CommandPaletteResult[] | Promise<CommandPaletteResult[]>;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy CommandStrategy contract references CommandPaletteResult until removal.
  onSelect: (result: CommandPaletteResult) => void;
  getCommands?: () => Command[];
  handleInput?: (text: string) => boolean | Promise<boolean>;
  onKeyDown?: (e: React.KeyboardEvent | KeyboardEvent) => void;
}
