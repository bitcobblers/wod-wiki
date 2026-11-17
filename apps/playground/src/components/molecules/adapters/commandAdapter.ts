import type { Command, CommandPaletteResult } from '@/components/organisms/command-palette/types';
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand';
import type { IListItem } from '../types';

export function commandToListItem(cmd: Command): IListItem<Command> {
  return {
    id: cmd.id,
    label: cmd.label,
    group: cmd.group,
    shortcut: cmd.shortcut,
    keywords: cmd.keywords,
    payload: cmd,
  };
}

export function paletteResultToListItem(
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy adapter kept until CommandPaletteResult callers are removed.
  result: CommandPaletteResult,
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy adapter kept until CommandPaletteResult callers are removed.
): IListItem<CommandPaletteResult> {
  return {
    id: result.id,
    label: result.name,
    subtitle: result.subtitle ?? result.category,
    group: result.category,
    keywords: [result.name, result.category],
    payload: result,
  };
}

export function scriptCommandToListItem(cmd: ScriptCommand): IListItem<ScriptCommand> {
  return {
    id: cmd.id,
    label: cmd.label,
    icon: cmd.icon,
    isDisabled: false,
    payload: cmd,
  };
}
