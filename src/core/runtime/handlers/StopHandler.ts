import { RuntimeEvent, ITimerRuntime, IRuntimeAction, StatementNode } from "@/core/timer.types";
import { EventHandler } from "@/core/runtime/EventHandler";
import { StopTimerAction } from "../actions/StopTimerAction";
import { completeButton, resumeButton } from "@/components/buttons";
import { SetButtonAction } from "../actions/SetButtonAction";

export class StopHandler extends EventHandler {
  protected eventType: string = 'stop';

  protected handleEvent(event: RuntimeEvent, stack: StatementNode[], runtime: ITimerRuntime): IRuntimeAction[] {    
    if (runtime.current) {
      // Remove any lingering 'pause' events to ensure paused state is cleared
      runtime.current.events = runtime.current.events.filter(ev => ev.name !== 'pause');
      // Only show Reset after stop (system control)
      return [
        new StopTimerAction(event),
        new SetButtonAction(
          event,
          [resumeButton, completeButton]
        )      
      ];
    }
    return [];
  }
}
