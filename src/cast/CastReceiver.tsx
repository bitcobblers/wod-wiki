import React, { useEffect, useState } from 'react';
import { WodTimer } from '@/components/clock/WodTimer';

import { Observable, Subscription } from 'rxjs';
import { cn } from '@/core/utils';
import { IDuration } from "@/core/IDuration";
import { OutputEvent } from "@/core/OutputEvent";

export interface CastReceiverProps {
  event$: Observable<OutputEvent>;
  className?: string;
}

export const CastReceiver: React.FC<CastReceiverProps> = ({ event$ , className}) => {  
  const [display, setDisplay] = useState<{ primary: IDuration; label: string; bag: { totalTime: IDuration } }>({
    primary: { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 },
    label: 'Timer',
    bag: { totalTime: { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 } },
  });
  const [receivedMessages, setReceivedMessages] = useState<{ time: string; type: string; message: string }[]>([]);
  const [debug] = useState(true);

  // Subscribe to the ChromecastEvent observable
  useEffect(() => {
    // Subscribing to events
    const sub: Subscription = event$.subscribe((event : OutputEvent) => {
      // Event received
      setReceivedMessages(prev => {
        const updated = [...prev, { time: new Date().toLocaleTimeString(), type: event.eventType, message: JSON.stringify(event.bag) }];
        // Messages updated
        return updated.slice(-5);
      });

      switch (event.eventType) {
        case 'SET_DISPLAY':
          // SET_DISPLAY event received
          setDisplay({
            primary: event.bag.spans ? event.bag.spans[0] : { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 },
            label: 'Timer',
            bag: { totalTime: event.bag.totalTime ? event.bag.totalTime : { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 } },
          });
          break;
        case 'SET_SOUND':
        case 'SET_DEBUG':
        case 'SET_ERROR':
        case 'HEARTBEAT':
        case 'SET_IDLE':
          // Handle other event types as needed
          break;
        default:
          // Unknown event type
          setReceivedMessages(prev => {
            const updated = [...prev, { time: new Date().toLocaleTimeString(), type: "UNKNOWN", message: `Unknown event type: ${event.eventType}` }];
            // Messages updated (unknown type)
            return updated.slice(-5);
          });
          break;
      }
    });
    return () => sub.unsubscribe();
  }, [event$]);

  return (
    <div className={cn("bg-gray-200 text-black", className || "")}>
      <div className="timer-container mb-6">
        <WodTimer 
          primary={display?.primary} 
          label={display?.label}
          total={display?.bag?.totalTime}
        />
      </div>      
      {/* Debug info - useful during development */}
      {debug && (
        <div className="mt-8 bg-white border border-gray-300">          
          <table className="w-full text-xs border border-gray-300">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-300">
                <th className="px-2 py-1 text-left font-semibold">Time</th>
                <th className="px-2 py-1 text-left font-semibold">Type</th>
                <th className="px-2 py-1 text-left font-semibold">Message</th>
              </tr>
            </thead>
            <tbody>
              {receivedMessages.length > 0 ? (
                [...receivedMessages].reverse().map((msg, idx) => (
                  <tr key={idx} className="border-b border-gray-200">
                    <td className="px-2 py-1 font-mono whitespace-nowrap">{msg.time}</td>
                    <td className="px-2 py-1 font-mono whitespace-nowrap">{msg.type}</td>
                    <td className="px-2 py-1">{msg.message}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={3} className="px-2 py-1">No messages received yet</td></tr>
              )}
            </tbody>
          </table>          
        </div>
      )}
    </div>
  );
};
