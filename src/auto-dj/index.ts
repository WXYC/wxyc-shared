/**
 * `@wxyc/shared/auto-dj`
 *
 * Shared type contracts for the auto-DJ system: the orchestrator <-> Arduino
 * management channel and the dj-site <-> orchestrator virtual switch API.
 * Generated from api.yaml (`components/schemas`); see networking-spec.md §5.
 *
 * @example
 * ```ts
 * import { AutoDJStatus, isHeartbeat } from '@wxyc/shared/auto-dj';
 * ```
 */

// Generated schemas (re-exported as the curated public surface).
export type {
  // Management channel
  AutoDJHeartbeat,
  AutoDJLastTrack,
  AutoDJCommand,
  AutoDJCommandAction,
  AutoDJAck,
  AutoDJNowPlaying,
  AutoDJErrorReport,
  AutoDJErrorLevel,
  AutoDJErrorCode,
  AutoDJButtonToggle,
  AutoDJState,
  AutoDJTransport,
  AutoDJDeviceStatus,
  // The generated oneOf alias is exported under a distinct name; prefer the
  // hand-written union below (it carries the discriminant for narrowing).
  AutoDJWebSocketMessage as AutoDJWebSocketMessageSchema,
  // Virtual switch API
  AutoDJStatus,
  AutoDJActivationSource,
  AutoDJActivationSourceType,
  AutoDJCurrentTrack,
  AutoDJDeviceSummary,
  AutoDJRelayState,
  AutoDJDeactivateResponse,
} from '../generated/models/index.js';

// Hand-written union + type guards.
export {
  type AutoDJWebSocketMessage,
  isHeartbeat,
  isCommand,
  isAck,
  isNowPlaying,
  isErrorReport,
  isButtonToggle,
} from './extensions.js';
