/**
 * Flowsheet DTOs
 *
 * The flowsheet is the real-time playlist of songs being played on air.
 */

import type { DateTimeEntry } from './common.dto.js';
import type { RotationBin } from './rotation.dto.js';

/** Base fields for all flowsheet entries */
export interface FlowsheetEntryBase {
  id: number;
  play_order: number;
  show_id: number;
}

/**
 * Flowsheet entry as returned by the API
 * Contains all possible fields - use type guards to narrow
 */
export interface FlowsheetEntryResponse extends FlowsheetEntryBase {
  // Song entry fields
  album_id?: number;
  track_title?: string;
  album_title?: string;
  artist_name?: string;
  record_label?: string;
  rotation_id?: number;
  rotation_bin?: RotationBin | null;
  request_flag: boolean;

  // Message/breakpoint fields
  message?: string;

  // Metadata fields (from cache)
  artwork_url?: string | null;
  discogs_url?: string | null;
  release_year?: number | null;
  spotify_url?: string | null;
  apple_music_url?: string | null;
  youtube_music_url?: string | null;
  bandcamp_url?: string | null;
  soundcloud_url?: string | null;
  artist_bio?: string | null;
  artist_wikipedia_url?: string | null;
}

/** Song entry in the flowsheet */
export interface FlowsheetSongEntry extends FlowsheetEntryBase {
  track_title: string;
  artist_name: string;
  album_title: string;
  record_label: string;
  request_flag: boolean;
  album_id?: number;
  rotation_id?: number;
  rotation_bin?: RotationBin | null;
}

/** Show block entry (start or end of a DJ's show) */
export interface FlowsheetShowBlockEntry extends FlowsheetEntryBase, DateTimeEntry {
  dj_name: string;
  isStart: boolean;
}

/** Message entry (talkset, etc.) */
export interface FlowsheetMessageEntry extends FlowsheetEntryBase {
  message: string;
}

/** Breakpoint entry (marks time boundaries) */
export interface FlowsheetBreakpointEntry extends FlowsheetMessageEntry, DateTimeEntry {}

/** Union type for all flowsheet entry types */
export type FlowsheetEntry =
  | FlowsheetSongEntry
  | FlowsheetBreakpointEntry
  | FlowsheetShowBlockEntry
  | FlowsheetMessageEntry;

/** Request to create a new flowsheet entry */
export type FlowsheetCreateRequest =
  | {
      // From catalog (with album_id)
      album_id: number;
      track_title: string;
      rotation_id?: number;
      request_flag: boolean;
      record_label?: string;
    }
  | {
      // Freeform entry (no album_id)
      artist_name: string;
      album_title: string;
      track_title: string;
      request_flag: boolean;
      record_label?: string;
    }
  | {
      // Message entry
      message: string;
    };

/** Request to update a flowsheet entry */
export interface FlowsheetUpdateRequest {
  track_title?: string;
  artist_name?: string;
  album_title?: string;
  record_label?: string;
  request_flag?: boolean;
}

/** Query parameters for flowsheet GET requests */
export interface FlowsheetQueryParams {
  page?: number;
  limit?: number;
  start_id?: number;
  end_id?: number;
  shows_limit?: number;
}

/** On-air DJ information */
export interface OnAirDJ {
  id: number;
  dj_name: string;
}

/** On-air status response */
export interface OnAirStatusResponse {
  djs: OnAirDJ[];
  onAir: string; // "on" | "off" or similar
}

// Type guards for narrowing FlowsheetEntry types

export function isFlowsheetSongEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetSongEntry {
  return 'track_title' in entry && entry.track_title !== undefined;
}

export function isFlowsheetShowBlockEntry(
  entry: FlowsheetEntry | FlowsheetEntryResponse
): entry is FlowsheetShowBlockEntry {
  return 'dj_name' in entry && entry.dj_name !== undefined;
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
