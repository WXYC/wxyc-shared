/**
 * @wxyc/shared
 *
 * Shared DTOs, test utilities, validation, and E2E tests for WXYC services.
 *
 * @example
 * ```ts
 * // Import DTOs
 * import { FlowsheetEntryResponse, AlbumSearchResult } from '@wxyc/shared/dtos';
 *
 * // Import test utilities
 * import { createTestAlbum, createTestFlowsheetEntry } from '@wxyc/shared/test-utils';
 *
 * // Import validation
 * import { isValidEmail, validateEmail } from '@wxyc/shared/validation';
 * ```
 */

export * from './dtos/index.js';
export * from './test-utils/index.js';
export * from './validation/index.js';
