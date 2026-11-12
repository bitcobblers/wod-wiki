import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTE_PATTERNS } from '../lib/routes'

export function SubscribePage() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const source = params.get('source')
    if (source) {
      navigate(`${ROUTE_PATTERNS.notebooks}?feed=${encodeURIComponent(source)}`, { replace: true })
      return
    }
    const nextParams = new URLSearchParams()
    const feed = params.get('feed')
    const q = params.get('q')
    if (feed) nextParams.set('feed', feed)
    if (q) nextParams.set('q', q)
    const search = nextParams.toString()
    navigate(search ? `${ROUTE_PATTERNS.feeds}?${search}` : ROUTE_PATTERNS.feeds, { replace: true })
  }, [location.search, navigate])

  return (
    <div className="p-8 text-center text-xs text-muted-foreground" data-testid="feed-subscription-intake">
      Redirecting to Feeds…
    </div>
  )
}
