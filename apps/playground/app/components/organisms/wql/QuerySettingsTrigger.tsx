/**
 * QuerySettingsTrigger — the button that opens a surface's query-settings
 * dialog.
 *
 * It appears in the app's existing "page options" chrome: the 2xl+ right
 * rail, the `⋯` dropdown below it, and the mobile right drawer — all three
 * render the same stream-controls block, so one button covers every
 * breakpoint.
 */
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { useCloseDropdownMenu } from '@/components/atoms/primitives/dropdown-menu'

export interface QuerySettingsTriggerProps {
  /** Open the surface's query settings. */
  onOpen: () => void
}

export function QuerySettingsTrigger({ onOpen }: QuerySettingsTriggerProps) {
  // The trigger lives inside the `⋯` dropdown on some breakpoints. Dismiss
  // the menu first — its portaled content would otherwise paint over the
  // dialog it opens.
  const closeDropdown = useCloseDropdownMenu()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        closeDropdown()
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
