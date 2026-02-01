/**
 * WXYC Shared DTOs
 *
 * This package serves as the single source of truth for all API response types
 * shared between the backend service and frontend applications.
 *
 * Types are manually defined here but validated against the OpenAPI spec
 * (api.yaml) via tests to ensure they stay in sync.
 */

export * from './flowsheet.dto.js';
export * from './catalog.dto.js';
export * from './rotation.dto.js';
export * from './schedule.dto.js';
export * from './dj.dto.js';
export * from './request.dto.js';
export * from './metadata.dto.js';
export * from './common.dto.js';

// Extensions that aren't already in the above files
export type { PaginatedResponse } from './extensions.js';
