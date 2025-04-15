import { PlayIcon, ArrowPathIcon, PauseIcon, FlagIcon, FolderArrowDownIcon } from "@heroicons/react/24/solid";
import { ButtonConfig } from "@/core/timer.types";



export const startButton: ButtonConfig = {
    label: "Run",
    icon: PlayIcon,
    onClick: () => {
      const time = new Date();
      return [
        {name: "begin", timestamp: time},
        {name: "start", timestamp: time}
      ]
    },
  };


  export const resumeButton: ButtonConfig = {
    label: "Resume",
    icon: PlayIcon,
    onClick: () => {
      return [{name: "start", timestamp: new Date()}]
    },
  };

  export const pauseButton: ButtonConfig = {
    label: "Pause",
    icon: PauseIcon,
    onClick: () => [{ name: "stop", timestamp: new Date() }],
  };

  export const endButton: ButtonConfig = {
    label: "End",
    icon: FlagIcon,
    onClick: () => [{ name: "end", timestamp: new Date() }],
  };

  export const resetButton: ButtonConfig = {
    label: "Reset",
    icon: ArrowPathIcon,
    onClick: () => {
      return [{name: "reset", timestamp: new Date()}]
    },
  };

  export const completeButton: ButtonConfig = {
    label: "Complete",
    icon: ArrowPathIcon,
    onClick: () => {
      return [{name: "complete", timestamp: new Date()}]
    },
  };

  export const saveButton: ButtonConfig = {
    label: "Save",
    icon: FolderArrowDownIcon,
    onClick: () => [{ name: "save", timestamp: new Date() }],
  };
