/**
 * Tests for OpenAPI breaking change detection
 *
 * These tests validate the breaking change detection logic and ensure
 * the CI pipeline can correctly identify API changes that would break
 * existing clients.
 *
 * Uses minimal inline specs for fast, focused tests.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - openapi-diff doesn't have TS declarations
import openapiDiff from 'openapi-diff';

interface DiffResult {
  breakingDifferencesFound: boolean;
  breakingDifferences?: BreakingDifference[];
  nonBreakingDifferences?: unknown[];
  unclassifiedDifferences?: unknown[];
}

interface BreakingDifference {
  type: string;
  entity: string;
  action: string;
  sourceSpecEntityDetails: unknown[];
  destinationSpecEntityDetails: unknown[];
}

/**
 * Run openapi-diff to detect breaking changes
 */
async function detectBreakingChanges(
  oldSpec: string,
  newSpec: string
): Promise<DiffResult> {
  const result = await openapiDiff.diffSpecs({
    sourceSpec: { content: oldSpec, location: 'old-spec.yaml', format: 'openapi3' },
    destinationSpec: { content: newSpec, location: 'new-spec.yaml', format: 'openapi3' },
  });
  return result;
}

/**
 * Create a minimal OpenAPI spec with customizable components
 */
function createMinimalSpec(options: {
  paths?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
} = {}): string {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: options.paths || {
      '/test': {
        get: {
          summary: 'Test endpoint',
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TestModel' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: options.schemas || {
        TestModel: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
  };
  return JSON.stringify(spec);
}

describe('Breaking Change Detection', () => {
  describe('Schema Changes', () => {
    it('should detect removing a required field as breaking', async () => {
      const oldSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
              // name field removed
            },
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should detect changing a field type as breaking', async () => {
      const oldSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' }, // Changed from integer to string
            },
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    // Note: openapi-diff doesn't detect enum value removal as breaking
    // This is a known limitation - for full enum coverage, consider oasdiff (Go tool)
    it.skip('should detect removing an enum value as breaking (not supported by openapi-diff)', async () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/status': {
            get: {
              summary: 'Get status',
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Status' },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {
          Status: {
            type: 'string',
            enum: ['pending', 'active', 'completed'],
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/status': {
            get: {
              summary: 'Get status',
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Status' },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {
          Status: {
            type: 'string',
            enum: ['pending', 'active'], // 'completed' removed
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should NOT flag adding an optional field as breaking', async () => {
      const oldSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        schemas: {
          TestModel: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
              newField: { type: 'string' }, // New optional field
            },
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });

    it('should NOT flag adding a new enum value as breaking', async () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/status': {
            get: {
              summary: 'Get status',
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Status' },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {
          Status: {
            type: 'string',
            enum: ['pending', 'active'],
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/status': {
            get: {
              summary: 'Get status',
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Status' },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {
          Status: {
            type: 'string',
            enum: ['pending', 'active', 'completed'], // 'completed' added
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });
  });

  describe('Endpoint Changes', () => {
    it('should detect removing an endpoint as breaking', async () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
          },
          '/posts': {
            get: {
              summary: 'Get posts',
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
          },
          // /posts endpoint removed
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should detect removing an HTTP method as breaking', async () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
            post: {
              summary: 'Create user',
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
            // POST method removed
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should NOT flag adding a new endpoint as breaking', async () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/users': {
            get: {
              summary: 'Get users',
              responses: { '200': { description: 'Success' } },
            },
          },
          '/posts': {
            get: {
              summary: 'Get posts',
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      });

      const result = await detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });
  });

  describe('Self-consistency', () => {
    it('identical specs should have no breaking changes', async () => {
      const spec = createMinimalSpec();
      const result = await detectBreakingChanges(spec, spec);
      expect(result.breakingDifferencesFound).toBe(false);
    });
  });
});

describe('Breaking Change Helper Functions', () => {
  describe('categorizeChange', () => {
    const categorizeChange = (changeType: string): 'critical' | 'warning' | 'safe' => {
      const criticalChanges = [
        'removed',
        'required.removed',
        'type.changed',
        'enum.value.removed',
        'path.removed',
      ];
      const warningChanges = ['required.added', 'enum.value.added'];

      if (criticalChanges.some((c) => changeType.includes(c))) {
        return 'critical';
      }
      if (warningChanges.some((c) => changeType.includes(c))) {
        return 'warning';
      }
      return 'safe';
    };

    it('should categorize removed fields as critical', () => {
      expect(categorizeChange('property.removed')).toBe('critical');
      expect(categorizeChange('required.removed')).toBe('critical');
    });

    it('should categorize type changes as critical', () => {
      expect(categorizeChange('type.changed')).toBe('critical');
    });

    it('should categorize removed enum values as critical', () => {
      expect(categorizeChange('enum.value.removed')).toBe('critical');
    });

    it('should categorize path removal as critical', () => {
      expect(categorizeChange('path.removed')).toBe('critical');
    });

    it('should categorize added required fields as warning', () => {
      expect(categorizeChange('required.added')).toBe('warning');
    });

    it('should categorize optional field additions as safe', () => {
      expect(categorizeChange('property.added')).toBe('safe');
    });
  });
});
