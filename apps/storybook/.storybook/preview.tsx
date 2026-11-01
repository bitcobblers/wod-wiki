import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { DatabaseProvider } from '../src/database/DatabaseContext';
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
  },
  decorators: [
    // Opt-in IndexedDB plane: only stories with `parameters: { database: true }`
    // mount the full DatabaseProvider and boot seed sync. All other component
    // stories stay fast and state-free in memory.
    (Story, context) => {
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
      return (
        <div className={`min-h-screen bg-background text-foreground ${isBleed ? '' : 'p-4 '}font-sans`}>
          <Story />
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
