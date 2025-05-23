"use client";

import React from "react";
import { IActionButton } from "@/core/IActionButton";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";
import { useScreen } from "@/contexts/ScreenContext";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

/**
 * Toggle component for enabling/disabling screen always-on feature
 * Renders as a button with appropriate icon based on current state
 */
export const ScreenOnToggle: React.FC = () => {
  const { screenOnEnabled, toggleScreenOn } = useScreen();

  return (
    <button
      onClick={() => toggleScreenOn()}
      className={`p-2 rounded-full transition-colors ${
        screenOnEnabled ? "bg-blue-100 text-blue-600" : "text-gray-500 hover:bg-gray-100"
      }`}
      title={screenOnEnabled ? "Screen will stay on during workout" : "Screen may turn off during workout"}
      aria-label={screenOnEnabled ? "Disable screen always-on" : "Enable screen always-on"}
    >
      {screenOnEnabled ? (
        <EyeIcon className="h-5 w-5" />
      ) : (
        <EyeSlashIcon className="h-5 w-5" />
      )}
    </button>
  );
};

/**
 * Factory function to create a button config for the ScreenOnToggle
 * that can be used in the ButtonRibbon component
 */
export function createScreenOnToggleButton(): IActionButton {
  const { screenOnEnabled, toggleScreenOn } = useScreen();

  return {
    icon: screenOnEnabled ? EyeIcon : EyeSlashIcon,
    event: "screen_toggle",
    onClick: () => {
      toggleScreenOn();
      return [] as IRuntimeEvent[];
    },
    isActive: screenOnEnabled,
  };
}
