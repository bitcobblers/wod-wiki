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
    // Every story shares the playground storage plane: the provider resolves
    // the active local database and runs the boot seed sync once per session.
    (Story) => (
      <DatabaseProvider>
        <Story />
      </DatabaseProvider>
    ),
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
      return (
        <div className="min-h-screen bg-background text-foreground p-4 font-sans">
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
          'Database',
          ['IndexedDB Selection'],
          'Playground',
          ['LibraryPage', 'EmptyWorkbench', 'IntervalStarter', 'ForTimeStarter', 'EmomStarter', '*'],
          'Workbench',
          [
            'Benchmark — Fran',
            'Tabata & EMOM',
            'The Golos Method — Kettlebell',
            'Strength & Triplet',
            'Swimming IM Prep',
            'Murph (Hero WOD)',
            'Custom Workout (Clone Template)',
            '*',
          ],
          'Gallery',
          ['WQL Example Gallery', 'Timer Screen', 'WQL Composer', 'Record Type Icons', '*'],
          'Data',
          'Sessions',
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'off' },
  },
};

export default preview;
