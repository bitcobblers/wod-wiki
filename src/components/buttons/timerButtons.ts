import { PlayIcon, ArrowPathIcon, PauseIcon, FlagIcon, FolderArrowDownIcon } from "@heroicons/react/24/solid";
import { IActionButton } from "@/core/IActionButton";
import { RunEvent } from "@/core/runtime/inputs/RunEvent";
import { StartEvent } from "@/core/runtime/inputs/StartEvent";
import { StopEvent } from "@/core/runtime/inputs/StopEvent";
import { EndEvent } from "@/core/runtime/inputs/EndEvent";
import { ResetEvent } from "@/core/runtime/inputs/ResetEvent";
import { CompleteEvent } from "@/core/runtime/inputs/CompleteEvent";
import { SaveEvent } from "@/core/runtime/inputs/SaveEvent";



export const startButton: IActionButton = {
    label: "Run",
    icon: PlayIcon,
    event: "run",
    onClick: () => [new RunEvent()]
  };


  export const resumeButton: IActionButton = {
    label: "Resume",
    icon: PlayIcon,
    event: "start",
    onClick: () => [new StartEvent()]
  };

  export const pauseButton: IActionButton = {
    label: "Pause",
    icon: PauseIcon,
    event: "stop",
    onClick: () => [new StopEvent()]
  };

  export const endButton: IActionButton = {
    label: "End",
    icon: FlagIcon,
    event: "end",
    onClick: () => [new EndEvent()]
  };

  export const resetButton: IActionButton = {
    label: "Reset",
    icon: ArrowPathIcon,
    event: "reset",
    onClick: () => [new ResetEvent()]
  };

  export const completeButton: IActionButton = {
    label: "Complete",
    icon: ArrowPathIcon,
    event: "complete",
    onClick: () => [new CompleteEvent()]
  };

  export const saveButton: IActionButton = {
    label: "Save",
    icon: FolderArrowDownIcon,
    event: "save",
    onClick: () => [new SaveEvent()]
  };
