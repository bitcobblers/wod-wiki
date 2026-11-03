import { useEffect, useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within, userEvent } from 'storybook/test';
import { createCompiler, createParser, RuntimeFactory, type IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { RuntimeDebugPanel } from '@/components/organisms/workout/RuntimeDebugPanel';
import { WorkoutContextPanel, type WorkoutContextMode } from '@/components/organisms/workout/WorkoutContextPanel';
import type { ScriptBlock } from '@/components/Editor/types';

const DEFAULT_SCRIPT = [
  '(3)',
  '  15 Kettlebell Swings @24kg',
  '  12 Push-ups',
  '  *:45 Rest',
].join('\n');

function buildScriptBlock(script: string): ScriptBlock {
  const parsed = createParser().read(script);
  return {
    id: 'debug-story-block',
    dialect: 'time',
    startLine: 0,
    endLine: script.split('\n').length,
    content: script,
    statements: parsed.statements,
    state: 'idle',
    version: 1,
    createdAt: 1790000000000,
    widgetIds: {},
  };
}

interface DebugPanelStoryArgs {
  script: string;
  mode: WorkoutContextMode;
  mountRuntime: boolean;
}

function RuntimeDebugHarness({ script, mountRuntime }: DebugPanelStoryArgs) {
  const block = useMemo(() => buildScriptBlock(script), [script]);
  const factoryRef = useRef<RuntimeFactory | null>(null);
  if (!factoryRef.current) {
    factoryRef.current = new RuntimeFactory(createCompiler());
  }

  const [runtime, setRuntime] = useState<IScriptRuntime | null>(null);

  useEffect(() => {
    const factory = factoryRef.current;
    if (!factory || !mountRuntime) {
      setRuntime(null);
      return;
    }
    const rt = factory.createRuntime(block, { debugMode: true });
    setRuntime(rt);
    return () => {
      if (rt) factory.disposeRuntime(rt);
    };
  }, [block, mountRuntime]);

  return (
    <div className="max-w-xl h-[540px] rounded-xl border border-border overflow-hidden shadow-sm" data-testid="runtime-debug-story">
      <RuntimeDebugPanel
        runtime={runtime}
        isOpen={true}
        onClose={() => {}}
        embedded={true}
        activeBlock={block}
      />
    </div>
  );
}

const meta: Meta<DebugPanelStoryArgs> = {
  title: 'Playground/Organisms/Workout/RuntimeDebugPanel',
  component: RuntimeDebugHarness,
  args: {
    script: DEFAULT_SCRIPT,
    mode: 'run',
    mountRuntime: true,
  },
  argTypes: {
    script: {
      control: 'text',
      description: 'Whiteboard Script compiled into statements and pushed onto the runtime stack',
    },
    mode: {
      control: 'inline-radio',
      options: ['edit', 'run', 'review'],
      description: 'WorkoutContextPanel display mode',
    },
    mountRuntime: {
      control: 'boolean',
      description: 'Mount a live IScriptRuntime instance so the Stack & Memory tab is populated',
    },
  },
};

export default meta;
type Story = StoryObj<DebugPanelStoryArgs>;

export const EmbeddedDebugger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Runtime Debugger')).toBeVisible();
    const stackTab = canvas.getByRole('button', { name: /Stack/i });
    await userEvent.click(stackTab);
    await expect(canvas.getByText(/Call Stack/i)).toBeVisible();
  },
};

export const ContextPanelModes: Story = {
  render: (args) => {
    const block = buildScriptBlock(args.script);
    return (
      <div className="max-w-xl rounded-xl border border-border bg-card p-4 shadow-sm">
        <WorkoutContextPanel
          block={block}
          mode={args.mode}
          showStartButton={args.mode === 'edit'}
          showMetadata={true}
        />
      </div>
    );
  },
};
