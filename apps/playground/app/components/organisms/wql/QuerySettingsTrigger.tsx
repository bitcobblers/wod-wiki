/**
 * QuerySettingsTrigger — the button that opens a surface's query-settings
 * dialog.
 *
 * Rendered inside the L3 rail (2xl+) and the L3 slide-over drawer (< 2xl) —
 * one SecondaryNav component covers every breakpoint.
 */
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { useCloseDropdownMenu } from '@/components/atoms/primitives/dropdown-menu'
import { useCloseNavigationDrawer } from '../../../nav/NavigationDrawerContext'

export interface QuerySettingsTriggerProps {
  /** Open the surface's query settings. */
  onOpen: () => void
}

export function QuerySettingsTrigger({ onOpen }: QuerySettingsTriggerProps) {
  // Dismiss any enclosing dropdown or L3 slide-over drawer first so its
  // portaled overlay never stacks above the modal dialog it opens.
  const closeDropdown = useCloseDropdownMenu()
  const closeDrawer = useCloseNavigationDrawer()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        closeDropdown()
        closeDrawer()
        onOpen()
      }}
      data-testid="query-settings-trigger"
      className="w-full justify-start gap-2 rounded-lg text-xs"
    >
      <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">Query settings</span>
    </Button>
  )
}
