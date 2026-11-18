import React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { cn } from '@/lib/utils';
import type { INavActivation, INavAction } from '@/nav/navTypes';

export interface ButtonGroupDropdownProps {
  primary: INavActivation;
  actions: INavActivation[];
  size?: 'sm' | 'default';
  className?: string;
  onAction?: (action: INavAction, activation: INavActivation) => void;
}

function fireAction(
  activation: INavActivation,
  onAction?: ButtonGroupDropdownProps['onAction'],
): void {
  if (onAction) {
    onAction(activation.action, activation);
    return;
  }
  if (activation.action.type === 'call') {
    activation.action.handler();
  }
}

export const ButtonGroupDropdown: React.FC<ButtonGroupDropdownProps> = ({
  primary,
  actions,
  size = 'default',
  className,
  onAction,
}) => {
  const PrimaryIcon = primary.icon;
  const padding = size === 'sm' ? 'min-h-[44px] px-2.5 py-1.5' : 'min-h-[44px] px-3 py-2';
  const iconPadding = size === 'sm' ? 'min-h-[44px] min-w-[44px] px-2 py-1.5' : 'min-h-[44px] min-w-[44px] px-2.5 py-2';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-lg overflow-hidden border border-border/70',
        'bg-muted text-muted-foreground shadow-sm hover:shadow-md transition-shadow font-medium',
        textSize,
        className,
      )}
    >
      <button
        type="button"
        title={primary.label}
        onClick={() => fireAction(primary, onAction)}
        className={cn(
          'flex items-center gap-2 transition-colors hover:bg-accent hover:text-accent-foreground',
          padding,
        )}
      >
        {PrimaryIcon && <PrimaryIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>{primary.label}</span>
      </button>

      <div className="w-px bg-border/60 self-stretch" />

      <Menu>
        <MenuTrigger
          aria-label={`More ${primary.label} options`}
          title="More options"
          className={cn(
            'flex h-auto w-auto rounded-none border-0 bg-transparent items-center justify-center transition-colors hover:bg-accent hover:text-accent-foreground',
            iconPadding,
          )}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end" sideOffset={6} className="min-w-[160px]">
          {actions.map((act, i) => {
            if (act.action.type === 'none') {
              return <MenuSeparator key={act.id ?? i} />;
            }
            const Icon = act.icon;
            return (
              <MenuItem
                key={act.id}
                value={act.id}
                onClick={() => fireAction(act, onAction)}
                className="gap-2"
              >
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                {act.label}
              </MenuItem>
            );
          })}
        </MenuContent>
      </Menu>
    </div>
  );
};
