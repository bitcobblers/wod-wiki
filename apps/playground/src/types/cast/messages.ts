// src/types/cast/messages.ts

import { IDisplayStackState as ImportedDisplayStackState, ITimerDisplayEntry as ImportedTimerDisplayEntry, IDisplayCardEntry as ImportedDisplayCardEntry } from '@/clock/types/DisplayTypes';
import type { IMetric } from '@bitcobblers/wod-wiki-engine';
import { IOutputStatement } from '@bitcobblers/wod-wiki-engine';

// Re-export for backward compatibility
export type ExecutionRecord = IOutputStatement;

// Re-export imported types to ensure they are available if needed
export type IDisplayStackState = ImportedDisplayStackState;
export type ITimerDisplayEntry = ImportedTimerDisplayEntry;
export type IDisplayCardEntry = ImportedDisplayCardEntry;

/**
 * Base message structure for all cast protocol messages
 */
export interface CastMessage {
  /** Message type identifier */
  type: CastMessageType;

  /** Unique message ID for request/response correlation */
  messageId: string;

  /** Session ID (if within a session) */
  sessionId?: string;

  /** Timestamp when message was created */
  timestamp: number;

  /** Message payload (varies by type) */
  payload: unknown;
}

/**
 * All possible message types in the cast protocol
 */
export type CastMessageType =
  // Connection & Discovery
  | 'register'              // Client registers with relay
  | 'register-ack'          // Relay acknowledges registration
  | 'discover'              // Caster requests available receivers
  | 'target-discovered'     // Relay reports available receiver
  | 'target-lost'           // Receiver disconnected from relay

  // Session Lifecycle
  | 'cast-request'          // Caster requests to start casting
  | 'cast-accepted'         // Receiver accepts cast request
  | 'cast-rejected'         // Receiver rejects cast request
  | 'cast-stop'             // Either party stops the session
  | 'session-ended'         // Relay confirms session ended

  // Runtime State Sync
  | 'state-update'          // Caster sends display state
  | 'state-ack'             // Receiver acknowledges state update

  // Event Forwarding
  | 'event-from-receiver'   // Receiver sends user input event
  | 'event-ack'             // Caster acknowledges event

  // Metrics & Heart Rate
  | 'metrics-update'        // Receiver sends metrics (including HR)
  | 'metrics-batch'         // Receiver sends batched metrics

  // Workout Completion
  | 'workout-complete'      // Receiver signals workout done
  | 'completion-ack'        // Caster acknowledges completion

  // Health & Error
  | 'ping'                  // Keep-alive ping
  | 'pong'                  // Keep-alive response
  | 'error'                 // Error message
  | 'reconnect';            // Request to reconnect session

export interface RegisterMessage extends CastMessage {
  type: 'register';
  payload: {
    clientType: 'caster' | 'receiver';
    clientId: string;
    clientName: string;
    capabilities: ClientCapabilities;
    protocolVersion: string;
  };
}

export interface ClientCapabilities {
  heartRateMonitor: boolean;
  maxHeartRateDevices?: number;
  multiUser: boolean;
  features: string[];
}

export interface RegisterAckMessage extends CastMessage {
  type: 'register-ack';
  payload: {
    success: boolean;
    relayId: string;
    error?: string;
    serverCapabilities: {
      maxSessionDuration: number;
      maxMetricsBatchSize: number;
      heartbeatInterval: number;
    };
  };
}

export interface DiscoverMessage extends CastMessage {
  type: 'discover';
  payload: {
    requiredCapabilities?: Partial<ClientCapabilities>;
  };
}

export interface TargetDiscoveredMessage extends CastMessage {
  type: 'target-discovered';
  payload: {
    targetId: string;
    name: string;
    type: 'android-tv' | 'web-receiver';
    capabilities: ClientCapabilities;
    inSession: boolean;
  };
}

export interface CastRequestMessage extends CastMessage {
  type: 'cast-request';
  payload: {
    targetId: string;
    sessionId: string;
    workout: WorkoutDefinition;
    caster: {
      id: string;
      name: string;
    };
    config: SessionConfig;
  };
}

export interface WorkoutDefinition {
  script: string;
  name?: string;
  initialState?: IDisplayStackState;
}

export interface SessionConfig {
  receiverControlEnabled: boolean;
  heartRateSyncEnabled: boolean;
  metricsSyncInterval: number;
  autoStopOnDisconnect: boolean;
}

export interface CastAcceptedMessage extends CastMessage {
  type: 'cast-accepted';
  payload: {
    ready: boolean;
    heartRateDevices?: HeartRateDeviceInfo[];
    users: ReceiverUser[];
  };
}

export interface HeartRateDeviceInfo {
  id: string;
  name: string;
  assignedUserId?: string;
  batteryLevel?: number;
}

export interface ReceiverUser {
  id: string;
  name: string;
  isHost: boolean;
  heartRateDeviceId?: string;
}

export interface CastRejectedMessage extends CastMessage {
  type: 'cast-rejected';
  payload: {
    sessionId: string;
    reason: 'busy' | 'incompatible' | 'user-declined' | 'error';
    message?: string;
  };
}

export interface CastStopMessage extends CastMessage {
  type: 'cast-stop';
  payload: {
    initiatedBy: 'caster' | 'receiver';
    reason: 'user-requested' | 'workout-complete' | 'error' | 'timeout';
    finalMetrics?: IMetric[];
  };
}

export interface StateUpdateMessage extends CastMessage {
  type: 'state-update';
  payload: {
    displayState: IDisplayStackState;
    sequenceNumber: number;
    delta?: DisplayStateDelta;
  };
}

export interface DisplayStateDelta {
  timerStackChanges?: {
    added?: ITimerDisplayEntry[];
    removed?: string[];
    modified?: Partial<ITimerDisplayEntry>[];
  };
  cardStackChanges?: {
    added?: IDisplayCardEntry[];
    removed?: string[];
    modified?: Partial<IDisplayCardEntry>[];
  };
  workoutStateChanged?: boolean;
  roundChanged?: boolean;
}

export interface StateAckMessage extends CastMessage {
  type: 'state-ack';
  payload: {
    sequenceNumber: number;
    processingTime: number;
  };
}

export interface EventFromReceiverMessage extends CastMessage {
  type: 'event-from-receiver';
  payload: {
    event: {
      name: EventName;
      timestamp: number;
      data?: unknown;
    };
    userId?: string;
  };
}

export type EventName =
  | 'start'
  | 'pause'
  | 'stop'
  | 'next'
  | 'reset'
  | 'tick';

export interface MetricsUpdateMessage extends CastMessage {
  type: 'metrics-update';
  payload: {
    metric: IMetric;
    userId?: string;
  };
}

export interface MetricsBatchMessage extends CastMessage {
  type: 'metrics-batch';
  payload: {
    metrics: IMetric[];
    heartRateData: HeartRateDataPoint[];
    batchStartTime: number;
    batchEndTime: number;
  };
}

export interface HeartRateDataPoint {
  timestamp: number;
  bpm: number;
  deviceId: string;
  userId?: string;
  rrIntervals?: number[];
}

export interface WorkoutCompleteMessage extends CastMessage {
  type: 'workout-complete';
  payload: {
    status: 'completed' | 'stopped' | 'failed';
    completionTime: number;
    totalDuration: number;
    executionLog: ExecutionRecord[];
    metrics: IMetric[];
    heartRateData: HeartRateDataPoint[];
    summary: WorkoutSummary;
  };
}

export interface WorkoutSummary {
  roundsCompleted: number;
  totalReps?: number;
  heartRateSummary?: HeartRateSummary[];
  caloriesBurned?: number;
}

export interface HeartRateSummary {
  userId?: string;
  deviceId: string;
  avgBpm: number;
  maxBpm: number;
  minBpm: number;
  timeInZones: {
    zone1: number;
    zone2: number;
    zone3: number;
    zone4: number;
    zone5: number;
  };
}

export interface PingMessage extends CastMessage {
  type: 'ping';
  payload: {
    clientTime: number;
  };
}

export interface PongMessage extends CastMessage {
  type: 'pong';
  payload: {
    originalTime: number;
    serverTime: number;
  };
}

export interface ErrorMessage extends CastMessage {
  type: 'error';
  payload: {
    code: ErrorCode;
    message: string;
    recoverable: boolean;
    action?: 'retry' | 'reconnect' | 'abort';
    context?: unknown;
  };
}

export type ErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_BUSY'
  | 'PROTOCOL_ERROR'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

export interface ReconnectMessage extends CastMessage {
  type: 'reconnect';
  payload: {
    sessionId: string;
    lastSequenceNumber: number;
    clientId: string;
  };
}

// ============================================================================
// WebRTC Signaling Messages (exchanged via Cast SDK custom namespace)
// ============================================================================

/**
 * Custom Cast namespace used for WebRTC signaling.
 * All SDP offers, answers, and ICE candidates are exchanged through this
 * namespace on the Cast message channel — no relay server needed.
 */
export const CAST_NAMESPACE = 'urn:x-cast:com.wodwiki';

/** Discriminated union of all signaling messages */
export type WebRTCSignalMessage =
  | WebRTCOfferMessage
  | WebRTCAnswerMessage
  | WebRTCIceCandidateMessage
  | CastReadyMessage;

/**
 * Broadcast by the receiver once its CAF context is READY — i.e. the custom
 * namespace is registered and it can answer offers. A sender still waiting
 * for an answer treats this as the green light to retransmit its offer
 * immediately rather than waiting for the next retry tick.
 */
export interface CastReadyMessage {
  type: 'cast-ready';
}

export interface WebRTCOfferMessage {
  type: 'webrtc-offer';
  sdp: string;
}

export interface WebRTCAnswerMessage {
  type: 'webrtc-answer';
  sdp: string;
}

export interface WebRTCIceCandidateMessage {
  type: 'webrtc-ice';
  candidate: RTCIceCandidateInit;
}
