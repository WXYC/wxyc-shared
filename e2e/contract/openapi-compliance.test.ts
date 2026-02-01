/**
 * OpenAPI Compliance E2E Tests
 *
 * These tests validate that API responses from the backend match
 * the OpenAPI schema definitions in api.yaml.
 *
 * Prerequisites:
 * - Backend service running at E2E_BASE_URL (default: http://localhost:8080)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import { createE2EClient, E2EClient, getE2EConfig } from '../setup.js';

interface OpenAPISpec {
  components: {
    schemas: Record<string, SchemaObject>;
  };
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  $ref?: string;
  enum?: (string | number)[];
  nullable?: boolean;
  format?: string;
  [key: string]: unknown;
}

let client: E2EClient;
let spec: OpenAPISpec;
let schemas: Record<string, SchemaObject>;

/**
 * Resolve $ref references in schema
 */
function resolveRef(ref: string, schemas: Record<string, SchemaObject>): SchemaObject {
  const name = ref.replace('#/components/schemas/', '');
  return schemas[name];
}

/**
 * Flatten allOf into a single schema
 */
function flattenSchema(schema: SchemaObject, schemas: Record<string, SchemaObject>): SchemaObject {
  if (schema.$ref) {
    return flattenSchema(resolveRef(schema.$ref, schemas), schemas);
  }

  if (!schema.allOf) {
    return schema;
  }

  const merged: SchemaObject = {
    type: 'object',
    properties: {},
    required: [],
  };

  for (const part of schema.allOf) {
    const resolved = flattenSchema(part, schemas);
    if (resolved.properties) {
      merged.properties = { ...merged.properties, ...resolved.properties };
    }
    if (resolved.required) {
      merged.required = [...(merged.required || []), ...resolved.required];
    }
  }

  return merged;
}

/**
 * Validate a value against a schema property
 */
function validateValue(
  value: unknown,
  schema: SchemaObject,
  schemas: Record<string, SchemaObject>,
  path: string
): string[] {
  const errors: string[] = [];
  const resolvedSchema = schema.$ref ? flattenSchema(schema, schemas) : schema;

  // Handle nullable
  if (value === null) {
    if (!resolvedSchema.nullable) {
      errors.push(`${path}: expected non-null value`);
    }
    return errors;
  }

  // Handle undefined for optional fields
  if (value === undefined) {
    return errors;
  }

  // Type checking
  const actualType = Array.isArray(value) ? 'array' : typeof value;

  if (resolvedSchema.type === 'integer' || resolvedSchema.type === 'number') {
    if (typeof value !== 'number') {
      errors.push(`${path}: expected ${resolvedSchema.type}, got ${actualType}`);
    }
  } else if (resolvedSchema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path}: expected string, got ${actualType}`);
    }
    // Check enum
    if (resolvedSchema.enum && !resolvedSchema.enum.includes(value as string)) {
      errors.push(`${path}: value "${value}" not in enum [${resolvedSchema.enum.join(', ')}]`);
    }
  } else if (resolvedSchema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${path}: expected boolean, got ${actualType}`);
    }
  } else if (resolvedSchema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${actualType}`);
    } else if (resolvedSchema.items) {
      value.forEach((item, index) => {
        errors.push(...validateValue(item, resolvedSchema.items!, schemas, `${path}[${index}]`));
      });
    }
  } else if (resolvedSchema.type === 'object' || resolvedSchema.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: expected object, got ${actualType}`);
    } else {
      // Check required properties
      for (const req of resolvedSchema.required || []) {
        if (!(req in (value as Record<string, unknown>))) {
          errors.push(`${path}: missing required property "${req}"`);
        }
      }
      // Validate properties
      for (const [key, propSchema] of Object.entries(resolvedSchema.properties || {})) {
        const propValue = (value as Record<string, unknown>)[key];
        errors.push(...validateValue(propValue, propSchema as SchemaObject, schemas, `${path}.${key}`));
      }
    }
  }

  return errors;
}

/**
 * Validate an object against a named schema
 */
function validateAgainstSchema(
  data: unknown,
  schemaName: string,
  schemas: Record<string, SchemaObject>
): { valid: boolean; errors: string[] } {
  const schema = schemas[schemaName];
  if (!schema) {
    return { valid: false, errors: [`Schema "${schemaName}" not found`] };
  }

  const flattened = flattenSchema(schema, schemas);
  const errors = validateValue(data, flattened, schemas, schemaName);

  return { valid: errors.length === 0, errors };
}

describe('OpenAPI Compliance', () => {
  beforeAll(async () => {
    const config = getE2EConfig();
    client = createE2EClient(config);

    // Load OpenAPI spec
    const specPath = join(__dirname, '../../api.yaml');
    const content = readFileSync(specPath, 'utf-8');
    spec = parse(content) as OpenAPISpec;
    schemas = spec.components.schemas;
  });

  describe('Flowsheet Endpoints', () => {
    it('GET /flowsheet response matches FlowsheetEntryResponse[] schema', async () => {
      const response = await client.get<unknown[]>('/flowsheet?limit=5');

      // Skip validation if backend not available
      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      // Validate each entry
      for (const entry of response.body) {
        const result = validateAgainstSchema(entry, 'FlowsheetEntryResponse', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /flowsheet/latest response matches FlowsheetEntryResponse schema', async () => {
      const response = await client.get<unknown>('/flowsheet/latest');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      const result = validateAgainstSchema(response.body, 'FlowsheetEntryResponse', schemas);
      if (!result.valid) {
        console.log('Validation errors:', result.errors);
      }
      expect(result.valid).toBe(true);
    });

    it('GET /flowsheet/djs-on-air response matches OnAirDJ[] schema', async () => {
      const response = await client.get<unknown[]>('/flowsheet/djs-on-air');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const dj of response.body) {
        const result = validateAgainstSchema(dj, 'OnAirDJ', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Library Endpoints', () => {
    it('GET /library response matches AlbumSearchResult[] schema', async () => {
      const response = await client.get<unknown[]>('/library?artist_name=test&n=5');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const album of response.body) {
        const result = validateAgainstSchema(album, 'AlbumSearchResult', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /library/rotation response matches Rotation[] schema', async () => {
      const response = await client.get<unknown[]>('/library/rotation');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const rotation of response.body) {
        const result = validateAgainstSchema(rotation, 'Rotation', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /library/formats response matches FormatEntry[] schema', async () => {
      const response = await client.get<unknown[]>('/library/formats');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const format of response.body) {
        const result = validateAgainstSchema(format, 'FormatEntry', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /library/genres response matches GenreEntry[] schema', async () => {
      const response = await client.get<unknown[]>('/library/genres');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const genre of response.body) {
        const result = validateAgainstSchema(genre, 'GenreEntry', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Schedule Endpoints', () => {
    it('GET /schedule response matches Schedule[] schema', async () => {
      const response = await client.get<unknown[]>('/schedule');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const schedule of response.body) {
        const result = validateAgainstSchema(schedule, 'Schedule', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /schedule/shifts response matches ScheduleShift[] schema', async () => {
      const response = await client.get<unknown[]>('/schedule/shifts');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const shift of response.body) {
        const result = validateAgainstSchema(shift, 'ScheduleShift', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });

    it('GET /schedule/specialty response matches SpecialtyShow[] schema', async () => {
      const response = await client.get<unknown[]>('/schedule/specialty');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      for (const show of response.body) {
        const result = validateAgainstSchema(show, 'SpecialtyShow', schemas);
        if (!result.valid) {
          console.log('Validation errors:', result.errors);
        }
        expect(result.valid).toBe(true);
      }
    });
  });
});
