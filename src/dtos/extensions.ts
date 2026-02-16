/**
 * TypeScript Extensions for DTOs
 *
 * Contains TypeScript-specific utilities that aren't expressible in OpenAPI:
 * - Generic types (PaginatedResponse<T>)
 * - Mapped types (WeeklySchedule)
 * - Union types (FlowsheetEntry)
 * - Type guards for runtime narrowing
 */

import type {
  FlowsheetEntryResponse,
  FlowsheetSongEntry,
  FlowsheetMessageEntry,
  FlowsheetBreakpointEntry,
  FlowsheetShowBlockEntry,
  FlowsheetCreateSongFromCatalog,
  FlowsheetCreateSongFreeform,
  FlowsheetCreateMessage,
  FlowsheetV2TrackEntry,
  FlowsheetV2ShowStartEntry,
  FlowsheetV2ShowEndEntry,
  FlowsheetV2DJJoinEntry,
  FlowsheetV2DJLeaveEntry,
  FlowsheetV2TalksetEntry,
  FlowsheetV2BreakpointEntry,
  FlowsheetV2MessageEntry,
  ScheduleShift,
  DayOfWeek,
} from '../generated/models/index.js';

// =============================================================================
// Generic Types (not expressible in OpenAPI)
// =============================================================================

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total?: number;
    hasMore?: boolean;
  };
}

// =============================================================================
// Mapped Types (not expressible in OpenAPI)
// =============================================================================

/** Weekly schedule organized by day */
export type WeeklySchedule = {
  [K in DayOfWeek]: ScheduleShift[];
};

// =============================================================================
// Union Types (not expressible in OpenAPI)
// =============================================================================

/** Union type for all V1 flowsheet entry types */
export type FlowsheetEntry =
  | FlowsheetSongEntry
  | FlowsheetBreakpointEntry
  | FlowsheetShowBlockEntry
  | FlowsheetMessageEntry;

/** Union type for POST /flowsheet request body (oneOf in OpenAPI) */
export type FlowsheetPostRequest =
  | FlowsheetCreateSongFromCatalog
  | FlowsheetCreateSongFreeform
  | FlowsheetCreateMessage;

/** Union type for all V2 flowsheet entry types (discriminated by entry_type) */
export type FlowsheetV2Entry =
  | FlowsheetV2TrackEntry
  | FlowsheetV2ShowStartEntry
  | FlowsheetV2ShowEndEntry
  | FlowsheetV2DJJoinEntry
  | FlowsheetV2DJLeaveEntry
  | FlowsheetV2TalksetEntry
  | FlowsheetV2BreakpointEntry
  | FlowsheetV2MessageEntry;

// =============================================================================
// Type Guards
// =============================================================================

export function isFlowsheetSongEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetSongEntry {
  return 'track_title' in entry && entry.track_title !== undefined;
}

export function isFlowsheetShowBlockEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetShowBlockEntry {
  return 'dj_name' in entry && (entry as FlowsheetShowBlockEntry).dj_name !== undefined;
}

export function isFlowsheetStartShowEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetShowBlockEntry {
  return isFlowsheetShowBlockEntry(entry) && entry.isStart === true;
}

export function isFlowsheetEndShowEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetShowBlockEntry {
  return isFlowsheetShowBlockEntry(entry) && entry.isStart === false;
}

export function isFlowsheetMessageEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetMessageEntry {
  return 'message' in entry && entry.message !== undefined && !('dj_name' in entry);
}

export function isFlowsheetTalksetEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetMessageEntry {
  return isFlowsheetMessageEntry(entry) && entry.message.includes('Talkset');
}

export function isFlowsheetBreakpointEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetBreakpointEntry {
  return isFlowsheetMessageEntry(entry) && entry.message.includes('Breakpoint');
}

// =============================================================================
// V2 Type Guards (discriminated by entry_type)
// =============================================================================

export function isV2TrackEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2TrackEntry {
  return entry.entry_type === 'track';
}

export function isV2ShowStartEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2ShowStartEntry {
  return entry.entry_type === 'show_start';
}

export function isV2ShowEndEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2ShowEndEntry {
  return entry.entry_type === 'show_end';
}

export function isV2DJJoinEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2DJJoinEntry {
  return entry.entry_type === 'dj_join';
}

export function isV2DJLeaveEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2DJLeaveEntry {
  return entry.entry_type === 'dj_leave';
}

export function isV2TalksetEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2TalksetEntry {
  return entry.entry_type === 'talkset';
}

export function isV2BreakpointEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2BreakpointEntry {
  return entry.entry_type === 'breakpoint';
}

export function isV2MessageEntry(
  entry: FlowsheetV2Entry
): entry is FlowsheetV2MessageEntry {
  return entry.entry_type === 'message';
}
