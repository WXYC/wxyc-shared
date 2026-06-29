/**
 * Auto-DJ TypeScript extensions.
 *
 * The schemas live in api.yaml (`components/schemas`) and are code-generated
 * into `src/generated/models/`. This file adds the hand-written union type and
 * type guards over the WebSocket management-channel messages, following the
 * pattern of `src/dtos/extensions.ts`.
 */
import type {
  AutoDJHeartbeat,
  AutoDJCommand,
  AutoDJAck,
  AutoDJNowPlaying,
  AutoDJErrorReport,
  AutoDJButtonToggle,
} from '../generated/models/index.js';

/** Discriminated union of every message that crosses the Arduino <-> orchestrator channel. */
export type AutoDJWebSocketMessage =
  | AutoDJHeartbeat
  | AutoDJCommand
  | AutoDJAck
  | AutoDJNowPlaying
  | AutoDJErrorReport
  | AutoDJButtonToggle;

export function isHeartbeat(msg: AutoDJWebSocketMessage): msg is AutoDJHeartbeat {
  return msg.type === 'heartbeat';
}

export function isCommand(msg: AutoDJWebSocketMessage): msg is AutoDJCommand {
  return msg.type === 'command';
}

export function isAck(msg: AutoDJWebSocketMessage): msg is AutoDJAck {
  return msg.type === 'ack';
}

export function isNowPlaying(msg: AutoDJWebSocketMessage): msg is AutoDJNowPlaying {
  return msg.type === 'now_playing';
}

export function isErrorReport(msg: AutoDJWebSocketMessage): msg is AutoDJErrorReport {
  return msg.type === 'error';
}

export function isButtonToggle(msg: AutoDJWebSocketMessage): msg is AutoDJButtonToggle {
  return msg.type === 'button_toggle';
}
