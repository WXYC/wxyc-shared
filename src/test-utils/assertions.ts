/**
 * Test Assertions
 *
 * Custom assertion helpers for common test patterns.
 */

import type {
  FlowsheetEntryResponse,
  AlbumSearchResult,
  ApiErrorResponse,
} from '../dtos/index.js';

/**
 * Assert that a response is a valid flowsheet entry
 */
export function assertValidFlowsheetEntry(entry: unknown): asserts entry is FlowsheetEntryResponse {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('Expected flowsheet entry to be an object');
  }

  const e = entry as Record<string, unknown>;

  if (typeof e.id !== 'number') {
    throw new Error('Expected flowsheet entry to have numeric id');
  }

  if (typeof e.play_order !== 'number') {
    throw new Error('Expected flowsheet entry to have numeric play_order');
  }

  if (typeof e.show_id !== 'number') {
    throw new Error('Expected flowsheet entry to have numeric show_id');
  }
}

/**
 * Assert that a response is a valid album search result
 */
export function assertValidAlbumSearchResult(result: unknown): asserts result is AlbumSearchResult {
  if (typeof result !== 'object' || result === null) {
    throw new Error('Expected album search result to be an object');
  }

  const r = result as Record<string, unknown>;

  if (typeof r.id !== 'number') {
    throw new Error('Expected album search result to have numeric id');
  }

  if (typeof r.album_title !== 'string') {
    throw new Error('Expected album search result to have string album_title');
  }

  if (typeof r.artist_name !== 'string') {
    throw new Error('Expected album search result to have string artist_name');
  }
}

/**
 * Assert that a response is a valid API error
 */
export function assertValidApiError(error: unknown): asserts error is ApiErrorResponse {
  if (typeof error !== 'object' || error === null) {
    throw new Error('Expected API error to be an object');
  }

  const e = error as Record<string, unknown>;

  if (typeof e.message !== 'string') {
    throw new Error('Expected API error to have string message');
  }
}

/**
 * Assert that an array contains items matching the expected structure
 */
export function assertArrayOfType<T>(
  arr: unknown,
  validator: (item: unknown) => asserts item is T
): asserts arr is T[] {
  if (!Array.isArray(arr)) {
    throw new Error('Expected value to be an array');
  }

  for (const item of arr) {
    validator(item);
  }
}

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, name = 'value'): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be defined`);
  }
}

/**
 * Assert response status and return typed body
 */
export function assertStatus(
  response: { status: number; body: unknown },
  expectedStatus: number
): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. Body: ${JSON.stringify(response.body)}`
    );
  }
}
