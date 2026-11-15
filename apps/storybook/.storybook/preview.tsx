import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { DatabaseProvider } from '../src/database/DatabaseContext';
import { StoryDomainStateProvider, type StoryDomainStateSpec } from '../src/testing/domainStates';
import '../src/index.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme for components',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
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
  decorators: [
    // Opt-in deterministic in-memory domain state (`parameters: { domainState }`)
    // or real browser IndexedDB plane (`parameters: { database: true }`).
    (Story, context) => {
      const domainState = context.parameters?.domainState as StoryDomainStateSpec | undefined;
      const storyRoute = context.parameters?.route as string | undefined;
      const storyRoutePath = context.parameters?.routePath as string | undefined;
      if (domainState !== undefined) {
        return (
          <StoryDomainStateProvider spec={domainState} route={storyRoute} routePath={storyRoutePath}>
            <Story />
          </StoryDomainStateProvider>
        );
      }
      if (context.parameters?.database) {
        return (
          <DatabaseProvider>
            <Story />
          </DatabaseProvider>
        );
      }
      return <Story />;
    },
    // Dark-Mode Standard host rule (wayfinder #994/#998): the `dark` class
    // lives on <html>, never on a wrapper — shared tokens resolve per
    // element (@theme inline), so this flips every story. Cleanup restores
    // light so one story's global never leaks into the next.
    (Story, context) => {
      const theme = context.globals?.theme || 'light';
      useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        return () => document.documentElement.classList.remove('dark');
      }, [theme]);
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
          {showOntology && (
            <div
              style={{
                position: 'fixed',
                right: 12,
                bottom: 12,
                zIndex: 9999,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(18, 23, 34, 0.92)',
                border: '1px solid #38bdf8',
                color: '#e5ecf4',
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              <span style={{ color: '#8b9bb4' }}>Ontology:</span>
              {storyFile && (
                <a
                  href={`${ontBase}/#/file/${storyFile.split('/').map(encodeURIComponent).join('/')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#38bdf8', textDecoration: 'underline' }}
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
                  style={{ color: '#34d399', textDecoration: 'underline' }}
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
                  style={{ color: '#fbbf24', textDecoration: 'underline' }}
                >
                  {jid} ↗
                </a>
              ))}
              <a
                href={ontBase}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#a78bfa', textDecoration: 'underline' }}
              >
                Explorer ↗
              </a>
            </div>
          )}
        </div>
      );
    },
  ],
  parameters: {
    layout: 'padded',
    options: {
      storySort: {
        order: [
          'Design System',
          ['Introduction', 'Design Tokens', 'Component Guidelines', '*'],
          'Packages',
          ['UI', ['Composer', 'Widgets', 'Blocks', 'Dialog', '*']],
          'Playground',
          ['Overview', 'Atoms', 'Molecules', 'Organisms', ['Editor', 'Workout', '*'], 'Views', 'Navigation', '*'],
          'Shared Resources',
          ['Seed & Database', 'Fixtures & Gallery', '*'],
          'Workbench',
          [
            'Language Workbench',
            'Parser Tests',
            ['Test Builder', 'Runner', '*'],
            'Database & Storage',
            ['IndexedDB Selection', 'Data Explorer', 'Session Explorer', '*'],
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
