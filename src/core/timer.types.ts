import { RuntimeStack } from "./runtime/RuntimeStack";

// TimerDisplay interface to represent the timer's visual state
export interface TimerDisplayBag {
    primary?: IClock;    
    label?: string;
    bag: { [key: string]: IClock }
}

export interface IClock  extends IDuration {
  toClock(): [string, string];
}

export interface IDuration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
  
}

export class TimerFromSeconds implements IClock {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;

  constructor(miliseconds: number) {    
    const multiplier = 10 ** 3;
    let remaining = miliseconds;

    this.days = Math.floor(remaining / 86400); 
    remaining %= 86400;

    this.hours = Math.floor(remaining / 3600);   
    remaining %= 3600;

    this.minutes = Math.floor(remaining / 60);    
    remaining %= 60;

    this.seconds = Math.floor(remaining);
    
    this.milliseconds = Math.round((remaining - this.seconds) * multiplier);
  }

  toClock(): [string, string] {
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    const days = this.days || 0;
    const hours = this.hours || 0;
    const minutes = this.minutes || 0;
    const seconds = this.seconds || 0;
    const milliseconds = this.milliseconds || 0;
    
    const clock = [];

    if (days && days > 0) {
      clock.push(`${days}`);
    }

    if ((hours && hours > 0) || clock.length > 0) {
      clock.push(`${pad(hours)}`);
    }

    if (clock.length > 0) {
      clock.push(`${pad(minutes)}`);
    }
    else
    {
      clock.push(`${minutes}`)
    }

    clock.push(`${pad(seconds)}`);
    
    return [clock.join(':'), milliseconds.toString()];  
  }
}
export interface IRuntimeAction {
    apply(runtime: ITimerRuntime): RuntimeEvent[];
  }

  export type WodRuntimeScript = {
    source: string;
    statements: StatementNode[];    
  };
  
  export interface WodWikiInitializer {
    code?: string;
    syntax: string;
  }
  
  export interface WodWikiToken {
    token: string;
    foreground: string;
    fontStyle?: string;
    hints: WodWikiTokenHint[];
  }
  
  export interface WodWikiTokenHint {
    hint: string;
    position: "after" | "before";
    offSet?: number | undefined;
  }
  
  export type MetricValue = {
    value: number;
    unit: string;
  };
  
  export class RuntimeTrace {  
    private trace: Map<number, [number, number]> = new Map();
    public history: StatementKey[] = [];
    
    get(id:number) : number {
      return this.trace.get(id)?.[0] ?? 0;
    }

    getTotal(id:number) : number {
      return this.trace.get(id)?.[1] ?? 0;
    }
  
    set(stack: StatementNode[]) : StatementKey {
     var key = new StatementKey(this.history.length + 1) ;
     var previous = this.history.length > 0 
      ? this.history[this.history.length - 1] 
      : undefined;

     for(const node of stack) {    
      const index = (this.trace.get(node.id)?.[0] ?? 0) + 1;
      const total = this.getTotal(node.id)+1;
      this.trace.set(node.id, [index, total]);
      key.push(node.id, index);
     }
 
 this.history.push(key);
     if (previous) {
      const diff = previous.not(key);      
      for(const id of diff) {
        const total = this.getTotal(id)
        this.trace.set(id, [0,total]);
      }
     }

     return key;
    }  
  }

  // Represents an instruction to update a specific metric for a result span
  export type RuntimeMetricEdit = {
    blockKey: string;
    index: number;
    metricType: 'repetitions' | 'resistance' | 'distance';
    newValue: MetricValue; // The parsed new value 
    createdAt: Date; // Timestamp when the edit was created
  };

  export interface IRuntimeLogger {
    write: (runtimeBlock: IRuntimeBlock) => ResultSpan[]
  }

export type RuntimeState = 'idle' | 'running' | 'paused' | 'stopped' | 'done' | undefined;

export interface ITimerRuntime {
  gotoComplete(): unknown;      
  display: TimerDisplayBag;
  buttons: ButtonConfig[];
  edits: RuntimeMetricEdit[];
  results: ResultSpan[];  
  trace: RuntimeTrace | undefined;
  script: RuntimeStack;
  current: IRuntimeBlock | undefined;  
  tick(events: RuntimeEvent[]): RuntimeEvent[];
  code:string;
  gotoBlock(node: StatementNode | undefined): IRuntimeBlock;  

  reset(): void;
  
  edit(metric: RuntimeMetricEdit): void;
  
}

/**
 * Returns all fragments of a specific type from an array of StatementFragments
 * @param fragments Array of StatementFragment objects to filter
 * @param type The type of fragments to retrieve
 * @returns Array of fragments matching the specified type
 */
export function getFragments<T extends StatementFragment>(fragments: StatementFragment[], type: string): T[] {
    return fragments.filter((fragment) => fragment.type === type) as T[];
}

export interface StatementFragment {
    type: string;
    meta?: SourceCodeMetadata;
    toPart: () => string;    
} 


export class StatementKey extends Map<number, number> {  
  public key: string;
  
  constructor(public index: number) {
    super();
    this.key = index.toString();    
  }
  
  push(id: number, index: number) {
    this.key += `|${id}:${index}`;
    this.set(id, index);
  }

  not(other: StatementKey) : number[] {
    const keys = Array.from(this.keys());
    const otherKeys = Array.from(other.keys());
    return  keys.filter(key => !otherKeys.includes(key));
  }

  toString() {
    return this.key;
  }
}


export interface StatementNode {
    id: number;
    parent?: number;    
    next?: number;
    rounds?: number;
    children: number[];
    meta: SourceCodeMetadata;
    fragments: StatementFragment[];
    isLeaf?: boolean; // Explicit flag to mark a node as a leaf even if it has children
}


export interface RuntimeResult {    
    round: number;
    stack: number[];
    timestamps: RuntimeEvent[];
  }
  

  export type RuntimeMetric = {
    effort: string;    
    repetitions?: MetricValue;
    resistance?: MetricValue;
    distance?: MetricValue;
  }
  
  export interface IRuntimeBlock {
    buttons: ButtonConfig[];    
    type: string;
    blockId: number;
    blockKey: string;
    events: RuntimeEvent[];
    stack?: StatementNode[];
    metrics: RuntimeMetric[];
    onEvent(event: RuntimeEvent, runtime: ITimerRuntime): IRuntimeAction[];
    report(): ResultSpan[]
    getState(): RuntimeState;
  }
   
  export type RuntimeEvent = { 
    timestamp: Date, 
    name: string    
  }
  
  export interface RuntimeBlockHandler {
    apply: (event: RuntimeEvent, runtime: ITimerRuntime) => IRuntimeAction[];
  }


export interface ButtonConfig {
  label?: string;
  icon: React.ForwardRefExoticComponent<React.PropsWithoutRef<React.SVGProps<SVGSVGElement>> & { title?: string, titleId?: string } & React.RefAttributes<SVGSVGElement>>;
  onClick: () => RuntimeEvent[];
  isActive?: boolean;
  variant?: 'primary' | 'secondary' | 'success';
}

export interface SourceCodeMetadata {
    line: number;
    startOffset: number;
    endOffset: number;
    columnStart: number;
    columnEnd: number;
    length: number;
}

export class ResultSpan {
  blockKey?: string;
  index?: number;
  stack?: number[];
  start?: RuntimeEvent;
  stop?: RuntimeEvent;
  label?: string;
  metrics: RuntimeMetric[] = [];
  duration(timestamp?: Date): number {
    let now = timestamp ?? new Date();
    const stopTime = (this.stop?.timestamp || now).getTime();
    const startTime = this.start?.timestamp.getTime() || 0;
    const calculatedDuration = stopTime - startTime;

    return calculatedDuration;
  }

  edit(edits: RuntimeMetricEdit[]) : ResultSpan {
    this.metrics = this.metrics.map(metric => {
      const selected = edits.filter(e => e.blockKey === this.blockKey && e.index === this.index);
      for (const edit of selected) {
        metric[edit.metricType] = edit.newValue;
      }
      return metric;
    });
    return this;
  }
}

  /**
   * Represents individual measurements within a workout block
   */
  export type WodMetric = {
    /** Reference to parent block */
    blockId: number;
    /** Position within the block */
    index: number;  
    /** Metric type (e.g., "reps", "weight", "time") */
    type: string;
    /** Numeric value of the metric */
    value: number;
  }
  
  /**
   * Interface for objects that calculate workout metrics
   */
  export interface WodMetricCalculator {
    /** Add a timer event to the calculation */
    push(event: RuntimeEvent): void;
    /** Get the calculated metrics */
    results: WodMetric[];
  }
  