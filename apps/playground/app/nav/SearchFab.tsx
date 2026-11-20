/**
 * SearchFab — the mobile search circle of the shared thumb dock.
 *
 * Rendered by ResponsiveActionsDock (which owns positioning, thumb-corner
 * alignment, keyboard lift, and safe-area clearance) — this component is
 * only the 56px circular button that opens the global search palette.
 */
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/utils'

export interface SearchFabProps {
  /** Opens the global search palette. */
  onOpen: () => void
}

export function SearchFab({ onOpen }: SearchFabProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search"
      title="Search"
      data-testid="search-fab"
      className={cn(
        'size-12 rounded-full flex items-center justify-center',
        'bg-card text-foreground shadow-lg ring-1 ring-foreground/10',
        'hover:bg-muted active:scale-95 transition-all',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      )}
    >
      <MagnifyingGlassIcon className="size-6" />
      <span className="sr-only">Search</span>
    </button>
  )
}
