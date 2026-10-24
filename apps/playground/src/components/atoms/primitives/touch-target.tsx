import * as React from "react"

/**
 * Expand the hit area to at least 44×44px on touch devices.
 * Uses an invisible centered span covering min 44×44px hit box.
 */
export function TouchTarget({ children }: { children: React.ReactNode }) {
  // ponytail: centered absolute span provides 44px tap target without changing visual layout; add fine-pointer suppression if desktop hover conflicts occur.
  return (
    <>
      <span
        className="absolute left-1/2 top-1/2 size-[max(100%,2.75rem)] -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
        aria-hidden="true"
      />
      {children}
    </>
  )
}
