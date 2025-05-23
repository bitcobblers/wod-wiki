/**
 * Integration test for timer and button functionality
 */

import { describe, it, expect } from 'vitest';
import { startButton, pauseButton, resetButton } from '@/components/buttons/timerButtons';
import { RunEvent } from '@/core/runtime/inputs/RunEvent';
import { StartEvent } from '@/core/runtime/inputs/StartEvent';
import { StopEvent } from '@/core/runtime/inputs/StopEvent';

describe('Timer and Button Integration Test', () => {
  it('should create proper events when button onClick is called', () => {
    // Test the Run button creates a RunEvent
    const runEvents = startButton.onClick();
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]).toBeInstanceOf(RunEvent);
    expect(runEvents[0].name).toBe('run');
    expect(runEvents[0].timestamp).toBeInstanceOf(Date);
  });

  it('should have all required properties on button interfaces', () => {
    // Test that buttons have the required IActionButton properties
    expect(startButton.label).toBe('Run');
    expect(startButton.event).toBe('run');
    expect(startButton.icon).toBeDefined();
    expect(typeof startButton.onClick).toBe('function');
    
    expect(pauseButton.label).toBe('Pause');
    expect(pauseButton.event).toBe('stop');
    expect(pauseButton.icon).toBeDefined();
    expect(typeof pauseButton.onClick).toBe('function');
  });

  it('should create different event types for different buttons', () => {
    const runEvents = startButton.onClick();
    const stopEvents = pauseButton.onClick();
    const resetEvents = resetButton.onClick();

    expect(runEvents[0].name).toBe('run');
    expect(stopEvents[0].name).toBe('stop');
    expect(resetEvents[0].name).toBe('reset');
  });

  it('should create events with recent timestamps', () => {
    const beforeTime = Date.now();
    const events = startButton.onClick();
    const afterTime = Date.now();

    const eventTime = events[0].timestamp.getTime();
    expect(eventTime).toBeGreaterThanOrEqual(beforeTime);
    expect(eventTime).toBeLessThanOrEqual(afterTime);
  });
});