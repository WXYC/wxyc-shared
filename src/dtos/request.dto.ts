/**
 * Request Line DTOs
 *
 * The request line allows listeners to request songs.
 */

import type { AlbumSearchResult } from './catalog.dto.js';

/** Song request from a listener */
export interface SongRequest {
  id: number;
  device_id: string;
  message: string;
  created_at: string;
  status: RequestStatus;
}

/** Request status */
export type RequestStatus = 'pending' | 'played' | 'rejected';

/** Request to submit a song request */
export interface SubmitRequestPayload {
  message: string;
}

/** Enhanced request with parsed data */
export interface EnhancedRequest extends SongRequest {
  parsed?: ParsedSongRequest;
  matches?: LibraryMatch[];
  artwork_url?: string;
  discogs_url?: string;
}

/** AI-parsed song request */
export interface ParsedSongRequest {
  artist?: string;
  song?: string;
  album?: string;
  confidence: number;
  interpretation?: string;
}

/** Library match for a request */
export interface LibraryMatch {
  album: AlbumSearchResult;
  confidence: number;
  matchType: 'exact' | 'fuzzy' | 'partial';
  reasoning?: string;
}

/** Anonymous device registration */
export interface DeviceRegistration {
  device_id: string;
  registered_at: string;
}

/** Device authentication token */
export interface DeviceToken {
  token: string;
  expires_at: string;
}

/** Rate limit info */
export interface RateLimitInfo {
  remaining: number;
  reset_at: string;
  limit: number;
}

/** Request submission response */
export interface RequestSubmissionResponse {
  success: boolean;
  request_id?: number;
  rate_limit?: RateLimitInfo;
  message?: string;
}
