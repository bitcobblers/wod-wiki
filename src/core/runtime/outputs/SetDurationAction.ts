import { TimeSpanDuration } from "@/core/TimeSpanDuration";
import { OutputEvent } from "@/core/OutputEvent";
import { ITimerRuntime } from "@/core/ITimerRuntime";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";
import { Subject } from "rxjs";
import { OutputAction } from "../OutputAction";
import { DurationSign } from "@/core/DurationSign";


export class SetDurationAction extends OutputAction {
    constructor(private originalMilliseconds: number, private sign: DurationSign, private target: string) {
        super('SET_CLOCK');
    }

    write(runtime: ITimerRuntime, _input: Subject<IRuntimeEvent>): OutputEvent[] {
        const currentBlock = runtime.trace.current();
        if (!currentBlock) {
            return [];
        }

        // Get the most recent RuntimeSpan from the block
        const builder = currentBlock.getSpanBuilder();
        const allTimeSpans = builder.Spans();
        
        const duration = new TimeSpanDuration(this.originalMilliseconds, this.sign, allTimeSpans);

        return [{
            eventType: this.eventType,
            bag: { duration: duration, target: this.target },
            timestamp: new Date()
        }];
    }
}
