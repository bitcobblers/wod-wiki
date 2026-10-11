import { useEffect, useState } from 'react'
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

async function resolvePlaygroundId(attempt: number): Promise<string> {
  if (!pendingPlaygroundId || pendingPlaygroundId.attempt !== attempt) {
    pendingPlaygroundId = {
      attempt,
      // /playground is the "new playground note" entry — every visit mints a
      // fresh note prefilled with the default template; the list at
      // /playgrounds is how you resume.
      promise: createPlaygroundPage(DEFAULT_PLAYGROUND_CONTENT.content),
    }
  }

  try {
    return await pendingPlaygroundId.promise
  } finally {
    if (pendingPlaygroundId?.attempt === attempt) {
      pendingPlaygroundId = null
    }
  }
}

/**
 * Canonical entry route for `/playground` — mints a fresh playground note
 * (default template) on every visit and opens it. Resuming existing notes
 * happens through the `/playgrounds` list. The dedup promise keeps StrictMode double-mounts
 * from minting two notes; the first-note wizard is unaffected (it gates on
 * profile state, not on freshness).
 */
export function PlaygroundRedirect() {
  const navigate = useNavigate()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const id = await resolvePlaygroundId(attempt)
        if (!cancelled) {
          navigate(playgroundPath(id), { replace: true })
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
  }, [navigate, attempt])

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
