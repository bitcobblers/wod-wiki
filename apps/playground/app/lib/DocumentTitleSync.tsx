import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from './telemetry-gtag'

/**
 * route, leaving leaf routes such as /effort/, /e/:slug and /playground/:id
 * alone so their own effects can set a dynamic title. Section titles use
 * prefix matching on purpose: deep routes (/journal/:date, /feeds/:slug)
 * belong to their section, which a profile-exact lookup cannot express.
 */
export function DocumentTitleSync() {
  const location = useLocation()

  useEffect(() => {
    const pathname = location.pathname

    if (
      !pathname.startsWith('/effort/')
      && !pathname.startsWith('/e/')
      && !pathname.startsWith('/playground/')
      // /equipment/:slug sets its own dynamic title (EquipmentDetailPage),
      // like the effort leaf routes; the bare list keeps the section title.
      && !pathname.startsWith('/equipment/')
    ) {
      let title = 'Wod.Wiki'
      if (pathname.startsWith('/journal')) title = 'Wod.Wiki - Journal'
      else if (pathname.startsWith('/catalogs')) title = 'Wod.Wiki - Notebooks'
      else if (pathname.startsWith('/feeds') || pathname.startsWith('/feed')) title = 'Wod.Wiki - Notes'
      else if (pathname.startsWith('/collections') || pathname.startsWith('/c/')) title = 'Wod.Wiki - Notes'
      else if (pathname.startsWith('/efforts')) title = 'Wod.Wiki - Efforts'
      else if (pathname.startsWith('/equipment')) title = 'Wod.Wiki - Equipment'
      else if (pathname.startsWith('/sessions') || pathname.startsWith('/session/') || pathname.startsWith('/results')) title = 'Wod.Wiki - Sessions'
      else if (pathname.startsWith('/dashboards') || pathname === '/dashboard' || pathname.startsWith('/dashboard/') || pathname.startsWith('/d/')) title = 'Wod.Wiki - Dashboards'
      else if (pathname.startsWith('/playgrounds')) title = 'Wod.Wiki - Playgrounds'
      else if (pathname.startsWith('/syntax')) title = 'Wod.Wiki - Syntax'
      else if (pathname.startsWith('/analytics')) title = 'Wod.Wiki - Analytics'
      document.title = title
    }

    // Next-tick dispatch lets leaf routes (e.g. /effort/) update document.title first
    const timer = setTimeout(() => {
      trackPageView(document.title, location.pathname + location.search)
    }, 0)

    return () => clearTimeout(timer)
  }, [location.pathname, location.search])

  return null
}
