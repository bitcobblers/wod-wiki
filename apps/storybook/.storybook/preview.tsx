import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { WodOverlayHost } from '@bitcobblers/wod-wiki-ui/primitives';
import { DatabaseProvider } from '../src/database/DatabaseContext';
import {
  StoryDomainStateProvider,
  isDomainStatePresetName,
  type StoryDomainStateSpec,
} from '../src/testing/domainStates';
import '../src/index.css';

const WOD_VIEWPORTS = {
  mobilePortrait: {
    name: 'Phone Portrait (375×812)',
    styles: { width: '375px', height: '812px' },
    type: 'mobile' as const,
  },
  mobileLandscape: {
    name: 'Phone Landscape (812×375)',
    styles: { width: '812px', height: '375px' },
    type: 'mobile' as const,
  },
  tablet: {
    name: 'Tablet (768×1024)',
    styles: { width: '768px', height: '1024px' },
    type: 'tablet' as const,
  },
  desktop: {
    name: 'Desktop (1440×900)',
    styles: { width: '1440px', height: '900px' },
    type: 'desktop' as const,
  },
  wideShell: {
    name: 'Wide 4-Zone Shell (1600×960)',
    styles: { width: '1600px', height: '960px' },
    type: 'desktop' as const,
  },
  chromecastTv: {
    name: 'Chromecast TV 16:9 (1920×1080)',
    styles: { width: '1920px', height: '1080px' },
    type: 'desktop' as const,
  },
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Mineral (Light) or Arctic Frost (Dark) palette on <html>',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', icon: 'sun', title: 'Mineral (Light)' },
          { value: 'dark', icon: 'moon', title: 'Arctic Frost (Dark)' },
        ],
        dynamicTitle: true,
      },
    },
    domainStateOverride: {
      description: 'Override parameters.domainState preset for targeted testing',
      toolbar: {
        title: 'Domain State',
        icon: 'database',
        items: [
          { value: 'story-default', title: 'Domain: Story Default' },
          { value: 'empty', title: 'Domain: Empty' },
          { value: 'populatedJournal', title: 'Domain: Populated Journal' },
          { value: 'activeSession', title: 'Domain: Active Session' },
          { value: 'scopedPropertyOverride', title: 'Domain: Scoped Property Override' },
          { value: 'skippedDependencyDiagnostic', title: 'Domain: Skipped Dependency Diagnostic' },
          { value: 'readOnlyFeedNote', title: 'Domain: Read-Only Feed Note' },
        ],
        dynamicTitle: true,
      },
    },
    reducedMotion: {
      description: 'Simulate prefers-reduced-motion for animation & timer testing',
      toolbar: {
        title: 'Motion',
        icon: 'play',
        items: [
          { value: 'no-preference', title: 'Motion: Full' },
          { value: 'reduce', title: 'Motion: Reduced' },
        ],
        dynamicTitle: true,
      },
    },
    ontology: {
      description: 'Show Ontology Explorer deep-link overlay',
      toolbar: {
        title: 'Ontology',
        icon: 'sharealt',
        items: [
          { value: 'off', title: 'Ontology Links: Off' },
          { value: 'on', title: 'Ontology Links: Show' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
    domainStateOverride: 'story-default',
    reducedMotion: 'no-preference',
    ontology: 'off',
  },
  decorators: [
    // Dark-Mode Standard host rule (wayfinder #994/#998): the `dark` class
    // lives on <html>, never on a wrapper — shared tokens resolve per
    // element (@theme inline), so this flips every story. Cleanup restores
    // light so one story's global never leaks into the next.
    // Kept first (outermost) so `html.dark` is toggled immediately even while
    // `StoryDomainStateProvider` below is hydrating.
    (Story, context) => {
      const theme = context.globals?.theme || 'light';
      const reducedMotion = context.globals?.reducedMotion === 'reduce';
      useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        return () => document.documentElement.classList.remove('dark');
      }, [theme]);
      useEffect(() => {
        if (reducedMotion) {
          document.documentElement.setAttribute('data-reduced-motion', 'true');
        } else {
          document.documentElement.removeAttribute('data-reduced-motion');
        }
        return () => document.documentElement.removeAttribute('data-reduced-motion');
      }, [reducedMotion]);
      const isBleed = context.parameters?.layout === 'fullscreen' || context.parameters?.canvas === 'none';
      const showOntology = context.globals?.ontology === 'on';
      const storyFile = typeof context.parameters?.fileName === 'string'
        ? context.parameters.fileName.replace(/^\.\//, '')
        : '';
      const ontologyMeta = (context.parameters?.ontology ?? {}) as { classes?: string[]; journeys?: string[] };
      const resolveOntologyBase = () => {
        if (typeof window === 'undefined') return 'https://wod.wiki/ontology';
        const host = window.location.hostname || '';
        const m = host.match(/^([a-z0-9-]+)\.story\.wod\.wiki$/i);
        if (m) return `https://${m[1]}.preview.wod.wiki/ontology`;
        if (host === 'story.wod.wiki') return 'https://wod.wiki/ontology';
        return 'https://main.preview.wod.wiki/ontology';
      };
      const ontBase = showOntology ? resolveOntologyBase() : '';
      return (
        <div className={`min-h-screen bg-background text-foreground ${isBleed ? '' : 'p-4 '}font-sans`}>
          <Story />
          <WodOverlayHost />
          {showOntology && (
            <div className="fixed right-3 bottom-3 z-[9999] flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-popover/95 px-2.5 py-1.5 font-mono text-xs text-popover-foreground shadow-sm">
              <span className="text-muted-foreground">Ontology:</span>
              {storyFile && (
                <a
                  href={`${ontBase}/#/file/${storyFile.split('/').map(encodeURIComponent).join('/')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  Story File ↗
                </a>
              )}
              {(ontologyMeta.classes ?? []).map((cls) => (
                <a
                  key={cls}
                  href={`${ontBase}/#/class/${encodeURIComponent(cls)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-metric-effort underline underline-offset-2"
                >
                  {cls} ↗
                </a>
              ))}
              {(ontologyMeta.journeys ?? []).map((jid) => (
                <a
                  key={jid}
                  href={`${ontBase}/#/journey/${encodeURIComponent(jid)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-metric-action underline underline-offset-2"
                >
                  {jid} ↗
                </a>
              ))}
              <a
                href={ontBase}
                target="_blank"
                rel="noopener noreferrer"
                className="text-metric-rounds underline underline-offset-2"
              >
                Explorer ↗
              </a>
            </div>
          )}
        </div>
      );
    },
    // Opt-in deterministic in-memory domain state (`parameters: { domainState }`)
    // or real browser IndexedDB plane (`parameters: { database: true }`).
    (Story, context) => {
      const storyDomainState = context.parameters?.domainState as StoryDomainStateSpec | undefined;
      const globalOverride = context.globals?.domainStateOverride;
      const hasOverrideRequest =
        typeof globalOverride === 'string' &&
        globalOverride !== 'story-default' &&
        isDomainStatePresetName(globalOverride);
      const domainState: StoryDomainStateSpec | undefined =
        storyDomainState !== undefined && hasOverrideRequest
          ? globalOverride
          : storyDomainState;
      const ignoredDomainOverride = storyDomainState === undefined && hasOverrideRequest;
      const storyRoute = context.parameters?.route as string | undefined;
      const storyRoutePath = context.parameters?.routePath as string | undefined;
      const storyTheme = context.globals?.theme === 'dark' ? 'dark' : 'light';
      if (domainState !== undefined) {
        return (
          <StoryDomainStateProvider spec={domainState} route={storyRoute} routePath={storyRoutePath} theme={storyTheme}>
            <Story />
          </StoryDomainStateProvider>
        );
      }
      const content = context.parameters?.database ? (
        <DatabaseProvider>
          <Story />
        </DatabaseProvider>
      ) : (
        <Story />
      );
      if (!ignoredDomainOverride) return content;
      return (
        <>
          {content}
          <div
            role="status"
            data-testid="storybook-domain-override-notice"
            className="fixed left-3 bottom-3 z-[9998] rounded-lg border border-warning/50 bg-popover/95 px-3 py-1.5 font-mono text-xs text-popover-foreground shadow-sm"
          >
            Domain State &ldquo;{globalOverride}&rdquo; ignored — this story renders static props without{' '}
            <code>parameters.domainState</code>.
          </div>
        </>
      );
    },
  ],
  parameters: {
    layout: 'padded',
    viewport: {
      options: WOD_VIEWPORTS,
    },
    options: {
      storySort: {
        order: [
          'Design System',
          ['Introduction', 'Design Tokens', 'UI-SDK Primitives', 'Brand & Identity', 'Component Guidelines', '*'],
          'Plan',
          ['Overview', 'Editor', 'Library', 'Calendar', 'Dialogs & Sheets', 'Navigation', '*'],
          'Track',
          ['Timer Surfaces', 'Fullscreen Timer', 'Runtime Debug Panel', '*'],
          'Analyze',
          ['WQL', 'Dashboards', 'Sessions', '*'],
          'Workbench',
          [
            'Inside the Runtime',
            'Language Workbench',
            'Parser Tests',
            ['Test Builder', 'Runner', '*'],
            'Database & Storage',
            ['IndexedDB Selection', 'Data Explorer', 'Session Explorer', '*'],
            'Resources',
            ['Seed & Database', 'Fixtures & Gallery', '*'],
            '*',
          ],
          '*',
        ],
      },
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
};

export default preview;
