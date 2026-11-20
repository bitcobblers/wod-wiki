import { useCallback, useContext } from 'react';
import { UNSAFE_NavigationContext, useInRouterContext } from 'react-router-dom';

/**
 * Router-safe `navigate` helper for components (such as `NoteEditor` or
 * `FullscreenTimer`) that may be rendered either inside `BrowserRouter` /
 * `MemoryRouter` or in isolated unit/Storybook tests without a Router.
 */
export function useOptionalNavigate(): ((to: string) => void) | undefined {
  const inRouter = useInRouterContext();
  const navCtx = useContext(UNSAFE_NavigationContext);

  const navigate = useCallback(
    (to: string) => {
      navCtx.navigator.push(to);
    },
    [navCtx],
  );

  return inRouter && navCtx?.navigator ? navigate : undefined;
}
