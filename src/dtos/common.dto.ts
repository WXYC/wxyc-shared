/**
 * Common DTOs shared across multiple domains
 */

/** Standard API error response */
export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Pagination parameters for requests */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

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

/** Date and time entry (used in flowsheet breakpoints) */
export interface DateTimeEntry {
  day: string;
  time: string;
}

/** Genre enum - matches database genres */
export type Genre =
  | 'Blues'
  | 'Rock'
  | 'Electronic'
  | 'Hiphop'
  | 'Jazz'
  | 'Classical'
  | 'Reggae'
  | 'Soundtracks'
  | 'OCS'
  | 'Unknown';

/** Format enum - physical media format */
export type Format = 'Vinyl' | 'CD' | 'Unknown';
