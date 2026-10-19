/**
 * runwayIndicator.ts — context carrying a RunwayShell's stage indicator
 * (host status slot + decorative pips). Consumers (e.g. MacOSChrome) render
 * it inside their window header in place of the static title, so the shell's
 * former status row no longer costs a line of the sticky window.
 */
import { createContext, useContext, type ReactNode } from 'react'

export interface RunwayIndicator {
  /** Host-provided status slot (stage label, toast, …). */
  status: ReactNode
  /** Decorative stage pips (aria-hidden). */
  pips: ReactNode
}

export const RunwayIndicatorContext = createContext<RunwayIndicator | null>(null)

/** Non-null only inside a RunwayShell's sticky window. */
export function useRunwayIndicator(): RunwayIndicator | null {
  return useContext(RunwayIndicatorContext)
}
