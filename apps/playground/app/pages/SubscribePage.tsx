import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTE_PATTERNS } from '../lib/routes'

export function SubscribePage() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const source = new URLSearchParams(location.search).get('source')
    if (source) {
      navigate(`${ROUTE_PATTERNS.notebooks}?feed=${encodeURIComponent(source)}`, { replace: true })
    } else {
      navigate(ROUTE_PATTERNS.notebooks, { replace: true })
    }
  }, [location.search, navigate])

  return (
    <div className="p-8 text-center text-xs text-muted-foreground" data-testid="feed-subscription-intake">
      Redirecting to Library…
    </div>
  )
}
