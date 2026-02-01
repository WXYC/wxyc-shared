/**
 * TypeScript Extensions for DTOs
 *
 * Contains TypeScript-specific utilities that aren't in the other DTO files.
 */

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
