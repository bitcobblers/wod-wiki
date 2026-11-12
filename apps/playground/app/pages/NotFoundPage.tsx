/**
 * NotFoundPage — 404 fallback for unknown routes.
 *
 * Mounted unconditionally as the App.tsx wildcard OUTSIDE SidebarLayout, so
 * it renders its own landmarks: the page must still expose a `<nav>`, a
 * `<main data-agent-status="ready">`, and an `<h1>` for agents and screen
 * readers (WW-026).
 */

import { useNavigate } from 'react-router-dom'
import { FileQuestion, Home } from 'lucide-react'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="h-full flex flex-col">
      <nav
        aria-label="Not found navigation"
        className="flex items-center gap-5 px-6 py-3 border-b bg-background"
      >
        <span className="text-sm font-semibold tracking-tight">WOD Wiki</span>
        <button
          type="button"
          data-testid="notfound-nav-home"
          onClick={() => navigate('/')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Home
        </button>
        <button
          type="button"
          data-testid="notfound-nav-journal"
          onClick={() => navigate('/journal')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Journal
        </button>
        <button
          type="button"
          data-testid="notfound-nav-notebooks"
          onClick={() => navigate('/notebooks')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Notebooks
        </button>
      </nav>
      <main
        data-agent-status="ready"
        aria-busy={false}
        className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center"
      >
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
          <FileQuestion className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="text-muted-foreground max-w-sm">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <button
          type="button"
          data-testid="notfound-go-home"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Home className="w-4 h-4" />
          Go home
        </button>
      </main>
    </div>
  )
}
