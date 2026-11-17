import type { Command } from '@/components/organisms/command-palette/types';
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

export function scriptCommandToListItem(cmd: ScriptCommand): IListItem<ScriptCommand> {
  return {
    id: cmd.id,
    label: cmd.label,
    icon: cmd.icon,
    isDisabled: false,
    payload: cmd,
  };
}
