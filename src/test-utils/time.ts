/**
 * Test Time Utilities
 *
 * Framework-agnostic time constants and formatting functions for tests.
 * Timer mocking should be implemented per-project using the test framework's APIs.
 */

import { format } from 'date-fns';

// Fixed timestamps for consistent testing
// A fixed "now" for tests: 2024-06-15 14:30:00 UTC
export const TEST_TIMESTAMPS = {
  NOW: new Date("2024-06-15T14:30:00.000Z"),
  ONE_HOUR_AGO: new Date("2024-06-15T13:30:00.000Z"),
  ONE_DAY_AGO: new Date("2024-06-14T14:30:00.000Z"),
  ONE_WEEK_AGO: new Date("2024-06-08T14:30:00.000Z"),
} as const;

// Time offset constants (in milliseconds)
export const TIME_OFFSETS = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

/** Format a date using date-fns format string */
export function formatDate(date: Date, formatStr: string = 'yyyy-MM-dd'): string {
  return format(date, formatStr);
}

/** Create a date offset from TEST_TIMESTAMPS.NOW */
export function offsetFromNow(offsetMs: number): Date {
  return new Date(TEST_TIMESTAMPS.NOW.getTime() + offsetMs);
}
