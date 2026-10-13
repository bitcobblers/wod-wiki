const REPO_URL = 'https://github.com/bitcobblers/wod-wiki'

export function TourFooter() {
  return (
    <footer data-testid="tour-footer" className="border-t border-border px-6 py-8">
      <p className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>© {new Date().getFullYear()} WOD Wiki</span>
        <span aria-hidden="true">·</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          GitHub repository
        </a>
      </p>
    </footer>
  )
}
