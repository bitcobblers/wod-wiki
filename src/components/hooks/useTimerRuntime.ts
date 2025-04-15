import { useRef, useState, useEffect } from "react";
import { IRuntimeBlock, ResultSpan, WodRuntimeScript, RuntimeMetricEdit } from "@/core/timer.types";
import { RuntimeStack } from "@/core/runtime/RuntimeStack";
import { RuntimeJit } from "@/core/runtime/RuntimeJit";
import { TimerRuntime } from "@/core/runtime/timer.runtime";
import { TimerDisplayBag, ButtonConfig, RuntimeEvent } from "@/core/timer.types";
import { startButton } from "../buttons/timerButtons";

/**
 * Hook props for useTimerRuntime
 */
export interface UseTimerRuntimeProps {
  /**
   * Called when a script is compiled with the compiled script
   */
  onScriptCompiled?: (script: WodRuntimeScript) => void;
  onResultsUpdated?: (results: ResultSpan[]) => void;
}

/**
 * Hook that manages the timer runtime lifecycle and state
 * 
 * The runtime is responsible for:
 * 1. Processing workout script
 * 2. Handling timer events (tick, start, pause, etc.)
 * 3. Generating actions that update the UI (display, buttons, results)
 * 
 * This new implementation uses the handler-based approach for workout processing.
 */
export function useTimerRuntime({
  onScriptCompiled,
  onResultsUpdated
}: UseTimerRuntimeProps = {}) {
  const runtimeRef = useRef<TimerRuntime>();
  const intervalRef = useRef<number | null>(null);
  const [state, setState] = useState<"idle" | "running" | "paused" | "error" | "done">("idle");
  const [cursor, setCursor] = useState<IRuntimeBlock | undefined>(undefined);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [script, loadScript] = useState<WodRuntimeScript | undefined>();
  const [display, setDisplay] = useState<TimerDisplayBag | undefined>();

  const [buttons, setButtons] = useState<ButtonConfig[]>([startButton]);
  const [results, setResults] = useState<ResultSpan[]>([]);
  const [edits, setEdits] = useState<RuntimeMetricEdit[]>([]);

  // Triggers the tick event every 100ms
  useEffect(() => {
    if (!runtimeRef.current) return;

    intervalRef.current = setInterval(() => {
      if (runtimeRef.current) {
        // Create the tick event
        const tick = { name: "tick", timestamp: new Date() };
        const block = runtimeRef.current.current;
        // Update state based on runtime current values
        
        if (block?.type === "idle" && (!runtimeRef.current.results || runtimeRef.current.results.length === 0)) {
          setState("idle");
        
        } else if (block?.type === "runtime" && block.events?.[block.events.length - 1]?.name == "stop") {
          setState("paused");
        
        } else if (block?.type === "runtime") {
          setState("running");
        
        } else if (block?.type === "done" && runtimeRef.current.results && runtimeRef.current.results.length > 0) {
          setState("done");
        }
        
        // Process all events and get resulting actions                                       
        setEvents(runtimeRef.current.tick([...events, tick]));      
      } else {
        setState("error");
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [events, runtimeRef]);
  const handleResultUpdated = (newResults: ResultSpan[]) => {
    setResults(newResults);
    if (onResultsUpdated) {
      onResultsUpdated(newResults);
    }
  };
  // Wraps the loadScript function to call onScriptCompiled
  const handleLoadScript = (newScript: WodRuntimeScript | undefined) => {
    loadScript(newScript);
    if (newScript && onScriptCompiled) {
      onScriptCompiled(newScript);
    }
  };

  // Loads the script into the runtime.
  useEffect(() => {
    if (!script?.statements) {
      return;
    }

    try {
      const jit = new RuntimeJit()
      // Create the compiled runtime with handlers
      const stack = new RuntimeStack(script.statements);
      
      // Create the timer runtime      
      runtimeRef.current = new TimerRuntime(script.source, stack, jit,setDisplay, setButtons, handleResultUpdated, setCursor, setEdits, setState); 
    } catch (error) {
      console.error("Failed to initialize runtime:", error);
    }
    return () => {
      runtimeRef.current = undefined;
    };
  }, [script]);

  return {
    loadScript: handleLoadScript,
    runtimeRef,
    cursor,
    edits,
    buttons,
    display,
    results,
    state,
    setEvents: setEvents
  };
}
