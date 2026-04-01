/**
 * Tests for OpenAPI breaking change detection
 *
 * These tests validate breaking change detection using oasdiff (Go CLI)
 * and ensure the CI pipeline can correctly identify API changes that
 * would break existing clients.
 *
 * Prerequisites: brew install oasdiff
 *
 * Uses minimal inline specs for fast, focused tests.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

interface DiffResult {
  breakingDifferencesFound: boolean;
  output: string;
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  tempFiles.length = 0;
});

/**
 * Run oasdiff breaking check between two specs.
 * Returns whether breaking changes were found (ERR-level).
 */
function detectBreakingChanges(oldSpec: string, newSpec: string): DiffResult {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const oldPath = join(tmpdir(), `oasdiff-old-${id}.json`);
  const newPath = join(tmpdir(), `oasdiff-new-${id}.json`);

  writeFileSync(oldPath, oldSpec);
  writeFileSync(newPath, newSpec);
  tempFiles.push(oldPath, newPath);

  try {
    const output = execSync(`oasdiff breaking "${oldPath}" "${newPath}" --fail-on ERR`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { breakingDifferencesFound: false, output };
  } catch (error) {
    const err = error as { status: number; stdout?: string; stderr?: string };
    // oasdiff exits 1 when breaking changes found with --fail-on
    if (err.status === 1) {
      return { breakingDifferencesFound: true, output: err.stdout || err.stderr || '' };
    }
    throw error;
  }
}

/**
 * Create a minimal OpenAPI spec with customizable components
 */
function createMinimalSpec(
  options: {
    paths?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  } = {}
): string {
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
    it('should detect removing a required field as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should detect changing a field type as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    // oasdiff classifies response enum value removal as info-level, not error,
    // because removing a value from a response doesn't break client requests.
    it('should NOT flag removing a response enum value as breaking (info-level)', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });

    it('should detect removing a request enum value as breaking', () => {
      const oldSpec = createMinimalSpec({
        paths: {
          '/status': {
            post: {
              summary: 'Set status',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/StatusRequest' },
                  },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
        schemas: {
          StatusRequest: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['pending', 'active', 'completed'] },
            },
          },
        },
      });

      const newSpec = createMinimalSpec({
        paths: {
          '/status': {
            post: {
              summary: 'Set status',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/StatusRequest' },
                  },
                },
              },
              responses: { '200': { description: 'Success' } },
            },
          },
        },
        schemas: {
          StatusRequest: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['pending', 'active'] }, // 'completed' removed
            },
          },
        },
      });

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should NOT flag adding an optional field as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });

    it('should NOT flag adding a new enum value as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });
  });

  describe('Endpoint Changes', () => {
    it('should detect removing an endpoint as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should detect removing an HTTP method as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(true);
    });

    it('should NOT flag adding a new endpoint as breaking', () => {
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

      const result = detectBreakingChanges(oldSpec, newSpec);
      expect(result.breakingDifferencesFound).toBe(false);
    });
  });

  describe('Self-consistency', () => {
    it('identical specs should have no breaking changes', () => {
      const spec = createMinimalSpec();
      const result = detectBreakingChanges(spec, spec);
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
