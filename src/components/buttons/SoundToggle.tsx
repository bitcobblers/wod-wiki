import React from 'react';
import { Switch } from '@headlessui/react';
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline';
import { useSound } from '@/contexts/SoundContext';
import { IActionButton } from "@/core/IActionButton";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";

interface SoundToggleProps {
  className?: string;
}

export const SoundToggle: React.FC<SoundToggleProps> = ({ className = '' }) => {
  const { soundEnabled, toggleSound } = useSound();

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <Switch
        checked={soundEnabled}
        onChange={toggleSound}
        className={`${
          soundEnabled ? 'bg-blue-600' : 'bg-gray-200'
        } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
      >
        <span className="sr-only">Enable sound</span>
        <span
          className={`${
            soundEnabled ? 'translate-x-6' : 'translate-x-1'
          } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
        />
      </Switch>
      {soundEnabled ? (
        <SpeakerWaveIcon className="h-5 w-5 text-blue-600" />
      ) : (
        <SpeakerXMarkIcon className="h-5 w-5 text-gray-400" />
      )}
    </div>
  );
};

/**
 * Creates a button config for the sound toggle
 */
export const createSoundToggleButton = (): IActionButton => {
  const { soundEnabled } = useSound();
  
  return {
    icon: soundEnabled ? SpeakerWaveIcon : SpeakerXMarkIcon,
    event: "sound_toggle",
    onClick: () => {
      // Return empty events array as this is handled by the toggle itself
      return [] as IRuntimeEvent[];
    },
    isActive: soundEnabled,
    variant: 'secondary',
  };
};
