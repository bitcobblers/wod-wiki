import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from './telemetry-gtag'

/**
 * Route → document title. The title names the concept the path addresses —
 * the path and the title always agree (ticket 09). Leaf routes that set their
 * own dynamic title (/effort/:slug, /equipment/:slug, /playground/:id) are
 * left alone so their own effects can win. Section titles use prefix
 * matching on purpose: deep routes (/day/:date, /feed/:slug, /notebook/:slug)
 * belong to their concept.
 */
export function DocumentTitleSync() {
  const location = useLocation()

  useEffect(() => {
    const pathname = location.pathname

    if (
      !pathname.startsWith('/effort/')
      && !pathname.startsWith('/playground/')
      // /equipment/:slug sets its own dynamic title (EquipmentDetailPage),
      // like the effort leaf routes; the bare list keeps the section title.
      && !pathname.startsWith('/equipment/')
    ) {
      let title = 'Wod.Wiki'
      if (pathname.startsWith('/day/')) title = 'Wod.Wiki - Day'
      else if (pathname.startsWith('/journal')) title = 'Wod.Wiki - Journal'
      else if (pathname.startsWith('/notebooks') || pathname.startsWith('/notebook/')) title = 'Wod.Wiki - Notebooks'
      else if (pathname === '/notes') title = 'Wod.Wiki - Notes'
      else if (pathname.startsWith('/note/')) title = 'Wod.Wiki - Note'
      else if (pathname.startsWith('/pages') || pathname.startsWith('/page/')) title = 'Wod.Wiki - Pages'
      else if (pathname.startsWith('/tags') || pathname.startsWith('/t/')) title = 'Wod.Wiki - Tags'
      else if (pathname === '/feeds') title = 'Wod.Wiki - Feeds'
      else if (pathname.startsWith('/feed/')) title = 'Wod.Wiki - Feed'
      else if (pathname.startsWith('/efforts')) title = 'Wod.Wiki - Efforts'
      else if (pathname.startsWith('/equipment')) title = 'Wod.Wiki - Equipment'
      else if (pathname.startsWith('/sessions') || pathname.startsWith('/session/')) title = 'Wod.Wiki - Sessions'
      else if (pathname.startsWith('/dashboards') || pathname.startsWith('/dashboard/')) title = 'Wod.Wiki - Dashboards'
      else if (pathname.startsWith('/playgrounds')) title = 'Wod.Wiki - Playgrounds'
      document.title = title
    }

    // Next-tick dispatch lets leaf routes (e.g. /effort/) update document.title first
    const timer = setTimeout(() => {
      trackPageView(document.title, location.pathname + location.search)
    }, 0)

    // Depend on pathname only: search-param changes (?tab=, ?q=) must not
    // emit extra pageviews for the same page.
    return () => clearTimeout(timer)
  }, [location.pathname])

  return null
}
