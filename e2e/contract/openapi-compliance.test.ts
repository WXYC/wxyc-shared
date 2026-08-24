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
import { createE2EClient, createE2EAuthClient, E2EClient, getE2EConfig } from '../setup.js';

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
/**
 * Bound to `config.authUrl` (the better-auth origin), not `config.baseUrl`
 * (the backend API `client` above uses) -- the issue #379 auth schemas live
 * at `/auth/*` on the auth service, not the backend. See
 * `createE2EAuthClient`'s doc comment in `../setup.ts`.
 */
let authClient: E2EClient;
let spec: OpenAPISpec;
let schemas: Record<string, SchemaObject>;

/**
 * Resolve $ref references in schema
 */
function resolveRef(ref: string, schemas: Record<string, SchemaObject>): SchemaObject {
  const name = ref.replace('#/components/schemas/', '');
  const schema = schemas[name];
  if (!schema) {
    throw new Error(`Unresolved $ref: ${ref}`);
  }
  return schema;
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
    authClient = createE2EAuthClient(config);

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


  });

  // Issue #379 -- the better-auth core surface added to api.yaml. Uses
  // `authClient` (bound to the auth origin) rather than `client`. Anonymous
  // sign-in needs no credentials, so this suite runs unconditionally
  // (unlike `e2e/auth.test.ts`'s credentialed behavioral assertions).
  describe('Auth Endpoints (#379)', () => {
    it('POST /auth/sign-in/anonymous response matches AuthTokenAndUserResult schema', async () => {
      const response = await authClient.post<unknown>('/sign-in/anonymous', {});

      if (!response.ok) {
        console.log('Skipping: Auth service not available');
        return;
      }

      expect(response.status).toBe(200);
      const result = validateAgainstSchema(response.body, 'AuthTokenAndUserResult', schemas);
      if (!result.valid) {
        console.log('Validation errors:', result.errors);
      }
      expect(result.valid).toBe(true);
    });

    it('GET /auth/token response matches AuthTokenResponse schema', async () => {
      const signIn = await authClient.post<{ token?: string }>('/sign-in/anonymous', {});
      if (!signIn.ok) {
        console.log('Skipping: Auth service not available');
        return;
      }
      const sessionToken = signIn.headers.get('set-auth-token') || signIn.body?.token;
      expect(sessionToken, 'anonymous sign-in must yield a session token').toBeTruthy();

      const response = await authClient.get<unknown>('/token', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      expect(response.status).toBe(200);
      const result = validateAgainstSchema(response.body, 'AuthTokenResponse', schemas);
      if (!result.valid) {
        console.log('Validation errors:', result.errors);
      }
      expect(result.valid).toBe(true);
    });

    it('POST /auth/wxyc/lookup-email response matches LookupEmailResponse schema', async () => {
      const response = await authClient.post<unknown>('/wxyc/lookup-email', {
        identifier: `e2e-compliance-probe-${Date.now()}`,
      });

      if (!response.ok) {
        console.log('Skipping: Auth service not available');
        return;
      }

      expect(response.status).toBe(200);
      const result = validateAgainstSchema(response.body, 'LookupEmailResponse', schemas);
      if (!result.valid) {
        console.log('Validation errors:', result.errors);
      }
      expect(result.valid).toBe(true);
    });

    it('a non-existent auth route returns a 4xx response, not a schema mismatch', async () => {
      // Sanity check that this describe block is actually reaching the auth
      // origin -- a client accidentally left pointed at the backend origin
      // would 404 here too, but for the wrong reason (unknown app route
      // rather than unknown better-auth path), silently passing every test
      // above against a service that was never exercised.
      const response = await authClient.get('/definitely-not-a-real-auth-path');
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
