import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@bitcobblers/wod-wiki-ui/primitives';
import { useCloseNavigationDrawer } from '../../../nav/NavigationDrawerContext';

export interface QuerySettingsTriggerProps {
  onOpen: () => void;
}

export function QuerySettingsTrigger({ onOpen }: QuerySettingsTriggerProps) {
  const closeDrawer = useCloseNavigationDrawer();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        closeDrawer();
        onOpen();
      }}
      data-testid="query-settings-trigger"
      className="w-full justify-start gap-2 rounded-lg text-xs"
    >
      <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">Query settings</span>
    </Button>
  );
}
