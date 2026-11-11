import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { playgroundPath } from '../lib/routes'
import { createPlaygroundPage } from '../services/createPlaygroundPage'
import { DEFAULT_PLAYGROUND_CONTENT } from '../templates/defaultPlaygroundContent'

/**
 * Shared in-flight promise so that StrictMode double-mount (and rapid remounts)
 * coordinate on a single "find or create" request. The attempt field lets an
 * explicit retry mint a fresh promise instead of re-awaiting a stale one.
 */
let pendingPlaygroundId: { attempt: number; promise: Promise<string> } | null = null

async function resolvePlaygroundId(
  attempt: number,
  createPage: (content: string) => Promise<string>,
  isCancelled: () => boolean,
): Promise<string> {
  if (!pendingPlaygroundId || pendingPlaygroundId.attempt !== attempt) {
    pendingPlaygroundId = {
      attempt,
      // /playground is the "new playground note" entry — every visit mints a
      // fresh note prefilled with the default template; the list at
      // /playgrounds is how you resume.
      promise: createPage(DEFAULT_PLAYGROUND_CONTENT.content),
    }
  }

  try {
    const id = await pendingPlaygroundId.promise
    // Only the run that actually finishes (and navigates) clears the shared
    // attempt. A cancelled run (StrictMode remount, re-render with a new
    // navigate identity) must leave the promise for its successor — clearing
    // here minted a fresh note on every re-render.
    if (!isCancelled() && pendingPlaygroundId?.attempt === attempt) {
      pendingPlaygroundId = null
    }
    return id
  } catch (err) {
    // A failed mint clears the slot so an explicit retry mints anew.
    if (pendingPlaygroundId?.attempt === attempt) {
      pendingPlaygroundId = null
    }
    throw err
  }
}

/** Production mint: the default template through the real playground intake. */
const defaultCreatePage = (): Promise<string> =>
  createPlaygroundPage(DEFAULT_PLAYGROUND_CONTENT.content)

/**
 * Canonical entry route for `/playground` — mints a fresh playground note
 * (default template) on every visit and opens it. Resuming existing notes
 * happens through the `/playgrounds` list. The dedup promise keeps StrictMode double-mounts
 * from minting two notes; the first-note wizard is unaffected (it gates on
 * profile state, not on freshness).
 */
export interface PlaygroundRedirectDeps {
  /** Mints a fresh playground note; defaults to the real intake over active storage. */
  createPage?: (content: string) => Promise<string>
}

export function PlaygroundRedirect({ createPage = defaultCreatePage }: PlaygroundRedirectDeps = {}) {
  const navigate = useNavigate()
  // `useNavigate` returns a new identity whenever the router context updates
  // (e.g. during boot-time registry/seed re-renders). Keeping it in a ref
  // lets the mint effect run once per mount — otherwise every re-render
  // re-entered the effect and minted yet another note.
  const navigateRef = useRef(navigate)
  useLayoutEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const id = await resolvePlaygroundId(attempt, createPage, () => cancelled)
        if (!cancelled) {
          navigateRef.current(playgroundPath(id), { replace: true })
        }
      } catch {
        if (!cancelled) {
          setError(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [attempt, createPage])

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-300 px-4 text-center">
        <p role="alert">Unable to create a new playground note.</p>
        <button
          type="button"
          className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800"
          onClick={() => {
            setError(false)
            setAttempt(value => value + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center text-zinc-400">
      Loading…
    </div>
  )
}
