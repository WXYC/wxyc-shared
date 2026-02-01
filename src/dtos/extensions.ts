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

/** Union type for all flowsheet entry types */
export type FlowsheetEntry =
  | FlowsheetSongEntry
  | FlowsheetBreakpointEntry
  | FlowsheetShowBlockEntry
  | FlowsheetMessageEntry;

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
