/**
 * useSelectWorkout — the "user picked a workout" navigation callback.
 *
 * Single source for both the route-view nav (`onRun`) and the page `onSelect`
 * handlers, so `AppContent` and `useRouteView` share one stable callback.
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTE_PATTERNS, notebookItemPath } from './routes'
import type { SelectWorkoutItem } from './routeView'

export function useSelectWorkout(): (item: SelectWorkoutItem) => void {
  const navigate = useNavigate()
  return useCallback(
    (item: SelectWorkoutItem) => {
      if (item.name === 'Home') {
        navigate(ROUTE_PATTERNS.home)
      } else {
        navigate(notebookItemPath(item.category ?? 'General', item.name))
      }
    },
    [navigate],
  )
}
