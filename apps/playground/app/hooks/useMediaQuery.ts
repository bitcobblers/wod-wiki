import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy Safari <14 MediaQueryList fallback
      mq.addListener(onChange)
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy Safari <14 MediaQueryList fallback
      return () => mq.removeListener(onChange)
    }
  }, [query])

  return matches
}
