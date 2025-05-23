import { TimeSpanDuration } from "@/core/TimeSpanDuration";
import { IRuntimeAction } from "@/core/IRuntimeAction";
import { ITimerRuntime } from "@/core/ITimerRuntime";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";
import { EventHandler } from "@/core/runtime/EventHandler";
import { NotifyRuntimeAction } from "../actions/NotifyRuntimeAction";
import { CompleteEvent } from "./CompleteEvent";
import { getDuration } from "../blocks/readers/getDuration";

export class TickEvent implements IRuntimeEvent {  
  timestamp: Date = new Date();
  name = 'tick';
}

export class TickHandler extends EventHandler {
  protected eventType: string = 'tick';

  protected handleEvent(_event: IRuntimeEvent, runtime: ITimerRuntime): IRuntimeAction[] {   
    const block = runtime.trace.current();      
    const spans = block?.getSpanBuilder().Spans();
    const timeSpans = spans && spans.length > 0 
      ? spans
      : [];
    const durationFragment = block?.selectMany(getDuration)[0];

    // If no duration fragment is associated with the block, or
    // if the fragment exists but its 'original' value is undefined (meaning duration was not specified in the script),
    // then this TickHandler should not cause a completion.
    if (!durationFragment || durationFragment.original === undefined) {
      return [];
    }

    // At this point, durationFragment exists and durationFragment.original is a number (e.g., 0, 10, etc.).
    // An explicit duration (like 0s) was provided.
    const spanDuration = new TimeSpanDuration(durationFragment.original, '+', timeSpans);
    const remaining = spanDuration.remaining();

    // Check if remaining time is zero or negative.
    if (remaining?.original !== undefined && remaining.original <= 0) {
      return [
        new NotifyRuntimeAction(new CompleteEvent(_event.timestamp))
      ];
    }
    return [];
  }
}