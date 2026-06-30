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
// Object/interface schemas (types only).
export type {
  // Management channel
  AutoDJHeartbeat,
  AutoDJLastTrack,
  AutoDJCommand,
  AutoDJAck,
  AutoDJNowPlaying,
  AutoDJErrorReport,
  AutoDJButtonToggle,
  AutoDJDeviceStatus,
  // The generated oneOf alias, exported under a distinct name. Prefer the
  // hand-written `AutoDJWebSocketMessage` union below for `switch`/guard code;
  // a compile-time tie in extensions.ts keeps the two from drifting apart.
  AutoDJWebSocketMessage as AutoDJWebSocketMessageSchema,
  // Virtual switch API
  AutoDJStatus,
  AutoDJActivationSource,
  AutoDJCurrentTrack,
  AutoDJDeviceSummary,
  AutoDJDeactivateResponse,
} from '../generated/models/index.js';

// String-enum schemas are generated as a const object + type alias — re-export
// them as VALUES so consumers can use e.g. `AutoDJCommandAction.pause` or iterate
// `Object.values(...)`, not just the type.
export {
  AutoDJCommandAction,
  AutoDJErrorLevel,
  AutoDJErrorCode,
  AutoDJState,
  AutoDJTransport,
  AutoDJActivationSourceType,
  AutoDJRelayState,
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
