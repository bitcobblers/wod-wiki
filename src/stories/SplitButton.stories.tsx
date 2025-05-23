import type { Meta, StoryObj } from '@storybook/react';
import '../index.css';
import { useState } from 'react';
import { SplitButton, SplitButtonOption } from '../components/buttons/SplitButton';
import { PlayIcon, StarIcon } from "@heroicons/react/24/solid";
import { IActionButton } from "@/core/IActionButton";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";

// Create a wrapper component for demonstration
const SplitButtonDemo = () => {
  const [events, setEvents] = useState<IRuntimeEvent[]>([]);
  const [lastAction, setLastAction] = useState<string>('No action taken');

  // Define the main action
  const mainAction: IActionButton = {
    label: "Primary",
    icon: PlayIcon,
    event: "primary",
    onClick: () => {
      const time = new Date();
      setLastAction('Primary action clicked');
      return [
        { name: "sample-action", timestamp: time },
      ];
    },
  };

  // Define dropdown options
  const options: SplitButtonOption[] = [
    {
      id: "option-1",
      label: "Option 1",
      onClick: () => {
        setLastAction('Option 1 clicked');
        return [{ name: "option-1", timestamp: new Date() }];
      },
    },
    {
      id: "option-2",
      label: "Option 2",
      onClick: () => {
        setLastAction('Option 2 clicked');
        return [{ name: "option-2", timestamp: new Date() }];
      },
    },
    {
      id: "option-3",
      label: "Option 3",
      onClick: () => {
        setLastAction('Option 3 clicked');
        return [{ name: "option-3", timestamp: new Date() }];
      },
    },
  ];

  // Define a custom action and options for variant demonstration
  const customAction: IActionButton = {
    label: "Custom",
    icon: StarIcon,
    event: "custom",
    onClick: () => {
      setLastAction('Custom action clicked');
      return [{ name: "custom", timestamp: new Date() }];
    },
  };

  const customOptions: SplitButtonOption[] = [
    {
      id: "custom-1",
      label: "Custom Option 1",
      onClick: () => {
        setLastAction('Custom Option 1 clicked');
        return [{ name: "custom-1", timestamp: new Date() }];
      },
    },
    {
      id: "custom-2",
      label: "Custom Option 2",
      onClick: () => {
        setLastAction('Custom Option 2 clicked');
        return [{ name: "custom-2", timestamp: new Date() }];
      },
    },
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Split Button Variants</h2>
        <div className="flex space-x-4">
          <div>
            <p className="text-sm text-gray-600 mb-2">Default</p>
            <SplitButton 
              mainAction={mainAction} 
              options={options} 
              setEvents={setEvents} 
            />
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-2">Success Variant</p>
            <SplitButton 
              mainAction={customAction} 
              options={customOptions} 
              setEvents={setEvents} 
              variant="success" 
            />
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-2">Active State</p>
            <SplitButton 
              mainAction={{...mainAction, isActive: true}} 
              options={options} 
              setEvents={setEvents} 
            />
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 border rounded-md bg-gray-50">
        <h3 className="font-semibold mb-2">Action Log</h3>
        <p className="text-gray-700">{lastAction}</p>
        <div className="mt-2">
          <h4 className="text-sm font-medium">Events:</h4>
          <pre className="bg-gray-100 p-2 rounded text-xs mt-1 max-h-40 overflow-y-auto">
            {JSON.stringify(events, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

const meta: Meta<typeof SplitButtonDemo> = {
  title: 'Components/SplitButton',
  component: SplitButtonDemo,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
export type SplitButtonStory = StoryObj<typeof SplitButtonDemo>;

export const Default: SplitButtonStory = {};
