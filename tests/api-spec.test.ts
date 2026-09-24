/**
 * Tests for the OpenAPI specification
 *
 * Validates that api.yaml is syntactically correct and contains all expected schemas.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  paths: Record<string, unknown>;
}

describe('OpenAPI Specification', () => {
  let spec: OpenAPISpec;

  // All eight OpenAPI 3.0 operation keys. Shared by every guard that walks the
  // document: a list one key short is a list with an exemption in it, and three
  // copies of it is three places for that exemption to appear.
  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

  function operations(): Array<[string, string, Record<string, unknown>]> {
    const found: Array<[string, string, Record<string, unknown>]> = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        if (!HTTP_METHODS.includes(method)) continue;
        found.push([method, path, operation as Record<string, unknown>]);
      }
    }
    return found;
  }
  // Raw source alongside the parsed tree, for assertions that must hold across
  // the whole document rather than inside one schema — e.g. a false citation
  // that could be copy-pasted into any description.
  let specText: string;

  beforeAll(() => {
    const specPath = join(__dirname, '..', 'api.yaml');
    const content = readFileSync(specPath, 'utf-8');
    specText = content;
    spec = parse(content) as OpenAPISpec;
  });

  // Composed schemas in this spec are `allOf: [<identity block>, <field block>]`
  // and either branch may be a `$ref` rather than an inline object — every V2
  // variant reaches its shared base that way, and `FlowsheetEntryResponse`
  // reaches its field block that way. A walk that only reads inline
  // `properties`/`required` off the immediate branches silently finds nothing
  // on those, which reads as "the field isn't declared" rather than "the
  // helper can't see it". These two follow `$ref` instead.
  function deref(node: unknown, seen = new Set<string>()): Record<string, unknown> | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const schema = node as Record<string, unknown>;
    const ref = schema.$ref;
    if (typeof ref !== 'string') return schema;
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    return deref(spec.components.schemas[ref.split('/').pop() as string], seen);
  }

  function propertyOf(schemaName: string, prop: string): Record<string, unknown> | undefined {
    function walk(node: unknown): Record<string, unknown> | undefined {
      const schema = deref(node);
      if (!schema) return undefined;
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties?.[prop]) return properties[prop];
      for (const branch of (schema.allOf as unknown[] | undefined) ?? []) {
        const found = walk(branch);
        if (found) return found;
      }
      return undefined;
    }
    return walk(spec.components.schemas[schemaName]);
  }

  // `propertyOf` stops at the first declaration it finds in composition order,
  // which answers "what shape does a consumer see" only while nothing else
  // declares the same key. This returns every declaration, so a test can assert
  // that a composed schema adds no local copy shadowing what it inherits — an
  // override placed after the `$ref` branch is invisible to `propertyOf` and
  // would otherwise pass an identity check while the generated type took the
  // shadow.
  function declarationsOf(schemaName: string, prop: string): Array<Record<string, unknown>> {
    const found: Array<Record<string, unknown>> = [];
    function walk(node: unknown): void {
      const schema = deref(node);
      if (!schema) return;
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties?.[prop]) found.push(properties[prop]);
      for (const branch of (schema.allOf as unknown[] | undefined) ?? []) walk(branch);
    }
    walk(spec.components.schemas[schemaName]);
    return found;
  }

  // Whether `schemaName` writes `prop` into its OWN YAML body — directly in
  // `properties`, or inline inside one of its own `allOf` branches — rather
  // than reaching it only by referencing another named schema that declares
  // it. Unlike `propertyOf`/`declarationsOf`, this does NOT follow a `$ref`
  // allOf branch: a schema that composes an already-declared schema that way
  // adds no new physical line to the document, so counting it as a
  // declaration site would double-count the one line it inherits from.
  function declaresPropertyLocally(schemaName: string, prop: string): boolean {
    function walk(node: unknown): boolean {
      if (!node || typeof node !== 'object') return false;
      const schema = node as Record<string, unknown>;
      if (typeof schema.$ref === 'string') return false;
      const properties = schema.properties as Record<string, unknown> | undefined;
      if (properties?.[prop]) return true;
      return ((schema.allOf as unknown[] | undefined) ?? []).some(walk);
    }
    return walk(spec.components.schemas[schemaName]);
  }

  function requiredKeysOf(schemaName: string): string[] {
    function walk(node: unknown): string[] {
      const schema = deref(node);
      if (!schema) return [];
      return [
        ...((schema.required as string[] | undefined) ?? []),
        ...((schema.allOf as unknown[] | undefined) ?? []).flatMap(walk),
      ];
    }
    // De-duplicated: composition here is a lattice, not a tree — two allOf
    // branches can reach the same field block (that is the whole point of
    // `FlowsheetEntryFields`), and a raw concat would then report a key twice
    // and fail an equality assertion for a reason that has nothing to do with
    // the contract.
    return [...new Set(walk(spec.components.schemas[schemaName]))];
  }

  // The effective property keys of a composed schema — every key reachable
  // through the flattened allOf lattice, deduplicated for the same
  // shared-branch reason as `requiredKeysOf`. Closed-set shape assertions
  // must use this rather than indexing individual allOf branches: a branch
  // index silently misses a property added via a new or reordered branch.
  function propertyKeysOf(schemaName: string): string[] {
    function walk(node: unknown): string[] {
      const schema = deref(node);
      if (!schema) return [];
      return [
        ...Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}),
        ...((schema.allOf as unknown[] | undefined) ?? []).flatMap(walk),
      ];
    }
    return [...new Set(walk(spec.components.schemas[schemaName]))];
  }

  describe('Structure', () => {
    it('should be valid OpenAPI 3.0', () => {
      expect(spec.openapi).toMatch(/^3\.0/);
    });

    it('should have info section with title and version', () => {
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe('WXYC Backend API');
      expect(spec.info.version).toBeDefined();
    });

    // The contract-version sentinel. It used to be re-planted inside whichever
    // feature block bumped it last (BS#1468's, then #297's), so every api.yaml
    // change edited a describe named for an unrelated ticket — and a forgotten
    // move filed the assertion under a ticket that didn't bump anything. It
    // lives here permanently now; update the literal, leave the location.
    it('pins info.version to the released contract version', () => {
      expect(spec.info.version).toBe('10.5.0');
    });

    it('should have components section', () => {
      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
    });

    it('should have paths section', () => {
      expect(spec.paths).toBeDefined();
    });
  });

  // A generated-client defect from this operation fails the way every one in
  // the #503 block failed: silently. Pin the shape against the handler rather
  // than trusting that a reviewer re-read both.
  describe('POST /auth/wxyc/update-identity', () => {
    type Operation = {
      security?: Array<Record<string, string[]>>;
      responses: Record<string, { content: Record<string, { schema: { $ref?: string } }> }>;
    };
    type Schema = {
      enum?: unknown[];
      required?: string[];
      properties?: Record<string, { $ref?: string; enum?: unknown[]; maxLength?: number; nullable?: boolean }>;
    };

    const op = (): Operation =>
      (spec.paths['/auth/wxyc/update-identity'] as Record<string, unknown>).post as Operation;
    const schema = (name: string): Schema => spec.components.schemas[name] as Schema;

    it('is declared and session-authenticated', () => {
      expect(op()).toBeDefined();
      expect(op().security).toEqual([{ SessionBearerAuth: [] }]);
    });

    it('declares every status the handler can answer', () => {
      expect(Object.keys(op().responses).sort()).toEqual(['200', '400', '401', '403', '429', '500']);
    });

    // The 500 is the one code-less error body, which is why it uses the plain
    // shape; the 429 comes from the express limiter, which is also code-less.
    // Every other error carries a code, which is what lets `code` be required.
    it('routes each error response to the shape that body actually has', () => {
      const schemaFor = (status: string): string | undefined =>
        op().responses[status]?.content['application/json']?.schema.$ref;
      for (const status of ['400', '401', '403']) {
        expect(schemaFor(status)).toBe('#/components/schemas/UpdateIdentityErrorResponse');
      }
      for (const status of ['429', '500']) {
        expect(schemaFor(status)).toBe('#/components/schemas/AuthPlainErrorResponse');
      }
      expect(schema('UpdateIdentityErrorResponse').required).toEqual(['error', 'code']);
    });

    it('admits exactly the two fields the handler allowlists, both bounded', () => {
      const request = schema('UpdateIdentityRequest');
      const props = Object.entries(request.properties ?? {});
      expect(props.map(([key]) => key).sort()).toEqual(['djName', 'realName']);
      for (const [, prop] of props) {
        expect(prop.maxLength).toBe(255);
        // Neither field may be nullable: the handler 400s on an explicit null,
        // and declaring it accepted would be a shape no client can rely on.
        expect(prop.nullable).toBeUndefined();
      }
      // Neither is individually required either -- "at least one" is a handler
      // rule OpenAPI cannot express.
      expect(request.required).toBeUndefined();
    });

    it('pins the error codes the handler raises', () => {
      expect(schema('UpdateIdentityErrorCode').enum).toEqual([
        'UNAUTHORIZED',
        'FORBIDDEN',
        'INVALID_REQUEST',
        'INVALID_DJ_NAME',
        'UPDATE_FAILED',
      ]);
    });

    // Both enums must stay NAMED. Inlining either one makes the Python
    // generator emit a bare top-level class numbered by document order, which
    // renames unrelated committed types in every consumer that vendors the
    // models -- measured on this very operation before it was fixed.
    it('keeps both enums behind named schemas rather than inline', () => {
      const property = (schemaName: string, key: string) => (schema(schemaName).properties ?? {})[key];

      const status = property('UpdateIdentityResponse', 'status');
      expect(status?.$ref).toBe('#/components/schemas/UpdateIdentityAck');
      expect(status?.enum).toBeUndefined();

      const code = property('UpdateIdentityErrorResponse', 'code');
      expect(code?.$ref).toBe('#/components/schemas/UpdateIdentityErrorCode');
      expect(code?.enum).toBeUndefined();
    });
  });


  describe('Common Schemas', () => {
    it('should define ApiErrorResponse', () => {
      expect(spec.components.schemas.ApiErrorResponse).toBeDefined();
    });

    it('should define PaginationParams', () => {
      expect(spec.components.schemas.PaginationParams).toBeDefined();
    });

    // The `Genre` and `Format` enum assertions that used to sit here are gone
    // with the components themselves (#367); "genre and format are open sets"
    // below now pins their absence. RotationBin stays: unlike those two it is
    // backed by a real Postgres enum type (`freq_enum`), so the database
    // enforces the closed set the spec declares.
    it('should define RotationBin enum', () => {
      const rotationBin = spec.components.schemas.RotationBin as { enum?: string[] };
      expect(rotationBin).toBeDefined();
      expect(rotationBin.enum).toEqual(['H', 'M', 'L', 'S']);
    });

    // DayOfWeek was pinned here until #372 removed it. It was a closed enum of
    // day names starting Sunday, and it modelled the same `schedule.day` column
    // that the live `Schedule` schema models as `{type: integer, minimum: 0,
    // maximum: 6}` starting Monday — a contradiction the spec carried in two
    // places at once. The database settles it: `smallint`, and the schema
    // comment reads `// days {0: mon, 1: tue, ... , 6: sun}`. Its two referents
    // (ScheduleShift, AddScheduleShiftRequest) survive because `POST /schedule`
    // uses them, so the enum went and they took the integer inline. The
    // assertion below replaces the old one: one model of the column, everywhere
    // it appears.
    it('models schedule.day the way the database does, and only once', () => {
      expect(spec.components.schemas.DayOfWeek).toBeUndefined();
      // Every declaration of the column agrees: `smallint`, 0 = Monday.
      const dayModels = ['Schedule', 'ScheduleShift', 'AddScheduleShiftRequest'].map((name) => {
        const day = (
          spec.components.schemas[name] as {
            properties?: { day?: { type?: string; minimum?: number; maximum?: number } };
          }
        ).properties?.day;
        return { name, type: day?.type, minimum: day?.minimum, maximum: day?.maximum };
      });
      for (const model of dayModels) {
        expect(model, model.name).toEqual({
          name: model.name,
          type: 'integer',
          minimum: 0,
          maximum: 6,
        });
      }
    });
  });

  describe('Flowsheet Schemas', () => {
    // Inline request bodies aren't reachable through `propertyOf`, which
    // resolves `components.schemas` only. Three blocks below assert on the two
    // flowsheet operations that carry one, so the reach lives here once rather
    // than as a bespoke deep-optional type per block.
    type InlineRequestSchema = {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    type InlineRequestBody = {
      required?: boolean;
      content?: { 'application/json'?: { schema?: InlineRequestSchema } };
    };
    type Operation = {
      requestBody?: InlineRequestBody;
      responses?: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }>;
    };

    function operationAt(path: string): Operation {
      return (spec.paths[path] as { post?: Operation } | undefined)?.post ?? {};
    }

    function requestSchemaAt(path: string): InlineRequestSchema {
      return operationAt(path).requestBody?.content?.['application/json']?.schema ?? {};
    }

    const JOIN = '/flowsheet/join';
    const FORCE_END = '/flowsheet/shows/{id}/force-end';

    it('should define FlowsheetEntryBase', () => {
      expect(spec.components.schemas.FlowsheetEntryBase).toBeDefined();
    });

    it('should define FlowsheetEntryResponse', () => {
      expect(spec.components.schemas.FlowsheetEntryResponse).toBeDefined();
    });

    it('should define FlowsheetSongEntry', () => {
      expect(spec.components.schemas.FlowsheetSongEntry).toBeDefined();
    });

    it('should define FlowsheetMessageEntry', () => {
      expect(spec.components.schemas.FlowsheetMessageEntry).toBeDefined();
    });

    // Deleted, and asserted absent so it cannot return. `{djs, onAir}` was
    // dj-site's client-side view model, composed in the browser after the
    // fetch -- no endpoint ever served it, and no path ever referenced it. Its
    // `onAir` was declared a status indicator of "on" or "off" while the only
    // code producing it emitted a rendered label ("Off Air", or a comma-joined
    // DJ list), so anything re-adding this shape is reintroducing a described
    // contract for a response that does not exist.
    it('does not define OnAirStatusResponse', () => {
      expect(spec.components.schemas).not.toHaveProperty('OnAirStatusResponse');
    });

    // OnAirDJ.id is the better-auth `auth_user.id` (a varchar(255) string) at
    // runtime, and legacy/tubafrenzy-mirrored shows have no user account at all
    // (their DJ surfaces on /flowsheet/djs-on-air with a null id). The schema is
    // typed accordingly: a nullable string, not the historically-wrong integer.
    describe('OnAirDJ.id (BS#1547)', () => {
      function onAirDjId(): Record<string, unknown> {
        const schema = spec.components.schemas.OnAirDJ as {
          properties: Record<string, Record<string, unknown>>;
        };
        return schema.properties.id!;
      }

      it('is a string, not an integer', () => {
        expect(onAirDjId().type).toBe('string');
      });

      it('is nullable (legacy DJs have no user account id)', () => {
        expect(onAirDjId().nullable).toBe(true);
      });
    });

    describe('track_position field (catalog-track-search Track 3 / E6)', () => {
      const getProperty = propertyOf;

      // String-typed to match Discogs's `release_track.position` (vinyl "A1",
      // CD "5", multi-disc "1-12"). FlowsheetEntryBase + FlowsheetSongEntry
      // already use this convention on the read side; E6-1 fills the write-side
      // gap (FlowsheetCreateSongFromCatalog, FlowsheetUpdateRequest) and the V2
      // response shape (FlowsheetV2TrackEntry).

      it('FlowsheetCreateSongFromCatalog should accept optional string track_position', () => {
        const trackPosition = getProperty('FlowsheetCreateSongFromCatalog', 'track_position');
        expect(trackPosition).toBeDefined();
        expect(trackPosition?.type).toBe('string');
      });

      it('FlowsheetCreateSongFromCatalog should not require track_position', () => {
        const schema = spec.components.schemas.FlowsheetCreateSongFromCatalog as { required?: string[] };
        expect(schema.required ?? []).not.toContain('track_position');
      });

      it('FlowsheetUpdateRequest should accept optional string track_position', () => {
        const trackPosition = getProperty('FlowsheetUpdateRequest', 'track_position');
        expect(trackPosition).toBeDefined();
        expect(trackPosition?.type).toBe('string');
      });

      it('FlowsheetV2TrackEntry should carry nullable string track_position in read responses', () => {
        const trackPosition = getProperty('FlowsheetV2TrackEntry', 'track_position');
        expect(trackPosition).toBeDefined();
        expect(trackPosition?.type).toBe('string');
        expect(trackPosition?.nullable).toBe(true);
      });
    });

    describe('rotation_id on FlowsheetCreateSongFreeform (BS#1308)', () => {
      function getProperty(schemaName: string, prop: string): Record<string, unknown> | undefined {
        const schema = spec.components.schemas[schemaName] as
          | { properties?: Record<string, Record<string, unknown>> }
          | undefined;
        return schema?.properties?.[prop];
      }

      it('FlowsheetCreateSongFreeform should accept optional integer rotation_id', () => {
        const rotationId = getProperty('FlowsheetCreateSongFreeform', 'rotation_id');
        expect(rotationId).toBeDefined();
        expect(rotationId?.type).toBe('integer');
      });

      it('FlowsheetCreateSongFreeform should not require rotation_id', () => {
        const schema = spec.components.schemas.FlowsheetCreateSongFreeform as { required?: string[] };
        expect(schema.required ?? []).not.toContain('rotation_id');
      });
    });

    describe('dj_name_override on POST /flowsheet/join (BS#1295)', () => {
      it('POST /flowsheet/join should accept optional string dj_name_override', () => {
        const schema = requestSchemaAt(JOIN);
        const override = schema.properties?.dj_name_override;
        expect(override).toBeDefined();
        expect(override?.type).toBe('string');
      });

      it('dj_name_override should cap maxLength at 255 to match auth_user.dj_name', () => {
        const override = requestSchemaAt(JOIN).properties?.dj_name_override;
        expect(override?.maxLength).toBe(255);
      });

      it('dj_name_override should not be in the required list', () => {
        const schema = requestSchemaAt(JOIN);
        expect(schema.required ?? []).not.toContain('dj_name_override');
      });
    });

    describe('intent + expected_show_id on POST /flowsheet/join (BS#2233)', () => {
      const joinProperties = () => requestSchemaAt(JOIN).properties ?? {};
      const joinResponse = (status: string) => operationAt(JOIN).responses?.[status];

      it('references intent as a named schema, not an inline enum', () => {
        // 25 of this file's 35 named string enums are $ref'd exactly once, so
        // single-use is the convention, not the exception. It matters more
        // than style here: `./dtos` re-exports `components['schemas']` only
        // and `openapi-types.d.ts` is not in the package export map, so an
        // inline enum leaves Backend-Service and dj-site hardcoding the string
        // literals for the one field whose whole purpose is an explicit,
        // unambiguous choice.
        expect(joinProperties().intent?.$ref).toBe('#/components/schemas/FlowsheetJoinIntent');
      });

      it('declares FlowsheetJoinIntent as a two-value string enum', () => {
        const intent = spec.components.schemas.FlowsheetJoinIntent as Record<string, unknown>;
        expect(intent).toBeDefined();
        expect(intent.type).toBe('string');
        expect(intent.enum).toEqual(['join', 'takeover']);
      });

      it('does not give intent a default — an absent field means "the caller did not choose"', () => {
        // A `default:` would let a generator materialize one of the two
        // decisions on a client that never made it, which is the silent
        // co-host bug wearing a different hat. Absence is its own state and
        // the server answers it with the 409.
        expect(spec.components.schemas.FlowsheetJoinIntent).not.toHaveProperty('default');
      });

      it('declares expected_show_id as an optional integer', () => {
        const expected = joinProperties().expected_show_id;
        expect(expected).toBeDefined();
        expect(expected?.type).toBe('integer');
      });

      it('leaves both new fields out of the required list', () => {
        const schema = requestSchemaAt(JOIN);
        expect(schema.required ?? []).not.toContain('intent');
        expect(schema.required ?? []).not.toContain('expected_show_id');
      });

      it('documents a 409 that $refs the purpose-built ShowAlreadyOpenError', () => {
        const conflict = joinResponse('409');
        expect(conflict).toBeDefined();
        expect(conflict?.content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/ShowAlreadyOpenError',
        );
      });

      // The three assertions below pin prose, following the same convention as
      // the /flowsheet/range block further down: each one is a fact a consumer
      // gets wrong by default, and each was false in 1.47.1.
      it('scopes the stale-expected_show_id conflict to takeover only', () => {
        // `expected_show_id`'s own description says it is "ignored otherwise",
        // but the 409 originally listed the stale-id case unscoped by intent.
        // Read literally that made {intent: 'join', expected_show_id: stale} a
        // 409 by one sentence and a 200 co-host join by the other -- an
        // ambiguity four codegen targets and the BS implementer would not
        // resolve identically. The server returns 200 there.
        const conflict = String(joinResponse('409')?.description ?? '');
        expect(conflict).toMatch(/scoped to `takeover` only/);
        expect(conflict).toMatch(/`expected_show_id` is ignored outright/);
      });

      it('types details.show so expected_show_id is a compare-and-set, not a key-path dig', () => {
        // The client is REQUIRED to read details.show.id and echo it back.
        // Against ApiErrorResponse's `additionalProperties: true` that reaches
        // consumers as an untyped bag in all four languages.
        expect(propertyOf('ShowAlreadyOpenError', 'details')?.$ref).toBe(
          '#/components/schemas/ShowAlreadyOpenErrorDetails',
        );
        expect(propertyOf('ShowAlreadyOpenErrorDetails', 'show')?.$ref).toBe(
          '#/components/schemas/ShowAlreadyOpenShow',
        );
        expect(propertyOf('ShowAlreadyOpenShow', 'id')?.type).toBe('integer');
      });

      it('marks details.show.dj_name nullable — null is the common case, not the edge', () => {
        // resolveDjNameForShow returns string | null, and null is what the
        // abandoned-show backlog resolves to. Structural, so --strict-nullable
        // (Python) and Swift optionals enforce it rather than a paragraph
        // asking clients to please guard.
        const djName = propertyOf('ShowAlreadyOpenShow', 'dj_name');
        expect(djName?.nullable).toBe(true);
        expect(String(djName?.description)).toMatch(/[Nn]ull is the common case/);
      });

      it('does not claim every 400 on this operation is an intent problem', () => {
        // POST /flowsheet/join 400s for a missing dj_id, an absent show_name
        // on the new-show path, and an over-long dj_name_override. The intent
        // handshake adds causes rather than replacing them.
        const badRequest = String(joinResponse('400')?.description ?? '');
        expect(badRequest).toMatch(/it does not replace them/);
        expect(badRequest).toMatch(/`dj_id`/);
      });
    });

    describe('ended_at on POST /flowsheet/shows/{id}/force-end (BS#2233)', () => {
      it('declares an optional date-time ended_at override', () => {
        expect(operationAt(FORCE_END).requestBody?.required).not.toBe(true);
        const endedAt = requestSchemaAt(FORCE_END).properties?.ended_at;
        expect(endedAt).toBeDefined();
        expect(endedAt?.type).toBe('string');
        expect(endedAt?.format).toBe('date-time');
      });
    });

    describe('metadata_status field (BS#891 / Epic C)', () => {
      const getProperty = propertyOf;

      it('should define MetadataStatus enum with all 5 BS-side values', () => {
        const metadataStatus = spec.components.schemas.MetadataStatus as { type?: string; enum?: string[] };
        expect(metadataStatus).toBeDefined();
        expect(metadataStatus.type).toBe('string');
        expect(metadataStatus.enum).toEqual([
          'pending',
          'enriching',
          'enriched_match',
          'enriched_no_match',
          'failed_no_retry',
        ]);
      });

      it('FlowsheetEntryResponse should $ref MetadataStatus on metadata_status', () => {
        const ms = getProperty('FlowsheetEntryResponse', 'metadata_status');
        expect(ms).toBeDefined();
        expect(ms?.$ref).toBe('#/components/schemas/MetadataStatus');
      });

      it('FlowsheetEntryResponse should not require metadata_status (absent on non-track / pre-Epic-C rows)', () => {
        const required = requiredKeysOf('FlowsheetEntryResponse');
        expect(required).not.toContain('metadata_status');
      });

      it('FlowsheetV2TrackEntry should $ref MetadataStatus on metadata_status', () => {
        const ms = getProperty('FlowsheetV2TrackEntry', 'metadata_status');
        expect(ms).toBeDefined();
        expect(ms?.$ref).toBe('#/components/schemas/MetadataStatus');
      });

      it('FlowsheetV2TrackEntry should not require metadata_status', () => {
        const required = requiredKeysOf('FlowsheetV2TrackEntry');
        expect(required).not.toContain('metadata_status');
      });
    });

    describe('projection-parity fields on FlowsheetEntryResponse (BS#1513 / BS#1534)', () => {
      // FlowsheetEntryResponse is the declared shape of the flowsheet mutation
      // echoes (POST/DELETE/PATCH /flowsheet) and the anonymous liveFs:update
      // SSE payload ($ref target of LiveFsUpdateEvent). Backend projects those
      // through CLIENT_FACING_FLOWSHEET_COLUMNS, which carries entry_type,
      // add_time, radio_hour, and dj_name — fields that rode the wire but were
      // undeclared here, so the SSOT under-described its own payload. They are
      // optional (absent/nullable on some rows), so none is added to `required`.
      const getProperty = propertyOf;

      const requiredKeys = requiredKeysOf;

      it('declares entry_type via the FlowsheetEntryType enum', () => {
        const entryType = getProperty('FlowsheetEntryResponse', 'entry_type');
        expect(entryType).toBeDefined();
        expect(entryType?.$ref).toBe('#/components/schemas/FlowsheetEntryType');
      });

      it('declares add_time as a date-time string', () => {
        const addTime = getProperty('FlowsheetEntryResponse', 'add_time');
        expect(addTime).toBeDefined();
        expect(addTime?.type).toBe('string');
        expect(addTime?.format).toBe('date-time');
      });

      it('declares radio_hour as a nullable date-time string', () => {
        const radioHour = getProperty('FlowsheetEntryResponse', 'radio_hour');
        expect(radioHour).toBeDefined();
        expect(radioHour?.type).toBe('string');
        expect(radioHour?.format).toBe('date-time');
        expect(radioHour?.nullable).toBe(true);
      });

      it('declares dj_name as a nullable string', () => {
        const djName = getProperty('FlowsheetEntryResponse', 'dj_name');
        expect(djName).toBeDefined();
        expect(djName?.type).toBe('string');
        expect(djName?.nullable).toBe(true);
      });

      it('keeps all four projection-parity fields optional', () => {
        const required = requiredKeys('FlowsheetEntryResponse');
        for (const field of ['entry_type', 'add_time', 'radio_hour', 'dj_name']) {
          expect(required).not.toContain(field);
        }
      });
    });

    // Successor to tubafrenzy's `/playlists/dailyEntries`, which dies at the
    // 2026-08-31 cutover (WXYC/wiki#91 Phase 4, WXYC/wxyc-shared#329). Three
    // consumers get built against this shape at roughly the same time — the
    // `archive` daily playlist, the wxyc.org historical-archive page, and iOS
    // V2 — so it is pinned here rather than reverse-engineered from whichever
    // ships first.
    describe('GET /flowsheet/range (Phase 4 — wiki#91 / #329)', () => {
      function rangeGet(): {
        security?: unknown[];
        description?: string;
        parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type?: string } }>;
        responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
      } {
        const path = spec.paths['/flowsheet/range'] as { get?: ReturnType<typeof rangeGet> } | undefined;
        // Throw rather than expect-then-dereference: an absent path would make
        // every test in this block report a TypeError instead of the missing
        // endpoint.
        if (!path?.get) throw new Error('/flowsheet/range is missing from api.yaml');
        return path.get;
      }

      it('is public — no auth, matching its sibling /flowsheet/search', () => {
        expect(rangeGet().security).toEqual([]);
      });

      it('requires start and end as epoch-millisecond integers', () => {
        const params = rangeGet().parameters ?? [];
        for (const name of ['start', 'end']) {
          const param = params.find((p) => p.name === name);
          expect(param, `missing query param ${name}`).toBeDefined();
          expect(param?.in).toBe('query');
          expect(param?.required).toBe(true);
          expect(param?.schema?.type).toBe('integer');
          // Epoch ms overflows int32 (has since 1970 + 24.8 days).
          expect(param?.schema).toMatchObject({ format: 'int64' });
        }
      });

      it('returns FlowsheetRangeResponse on 200 and ApiErrorResponse on 400', () => {
        const responses = rangeGet().responses ?? {};
        expect(responses['200']?.content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/FlowsheetRangeResponse'
        );
        expect(responses['400']?.content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/ApiErrorResponse'
        );
      });

      it('documents the 8-day window ceiling that bounds this unpaginated unauthenticated route', () => {
        const description = rangeGet().description ?? '';
        expect(description).toMatch(/8 days/);
        const badRequest = rangeGet().responses?.['400'] as { description?: string } | undefined;
        expect(badRequest?.description).toMatch(/8 days/);
      });

      // Each of these three is a documented invariant of the underlying tables
      // that a reader of the plan alone would get wrong, and that all three
      // consumers would then get wrong identically.
      it('orders entries by add_time, and says why not play_order', () => {
        const description = rangeGet().description ?? '';
        // play_order is assigned per-show by two independent writers, so it
        // interleaves the many shows a window spans (2026-05-01 incident).
        expect(description).toMatch(/`add_time` ascending/);
        expect(description).toMatch(/[Nn]ot by `play_order`/);
        expect(String(propertyOf('FlowsheetRangeResponse', 'entries')?.description)).toMatch(/NOT by `play_order`/);
      });

      it('forbids reading a null end_time as "on the air"', () => {
        // A dropped show_end delivery leaves end_time NULL permanently, so
        // treating NULL as open-ended makes every orphaned historical show
        // intersect every window forever.
        expect(rangeGet().description ?? '').toMatch(/does not\s+mean "on the air"/);
        expect(String(propertyOf('FlowsheetRangeShow', 'end_time')?.description)).toMatch(/two.*causes/s);
      });

      it('warns that show_end markers can be absent, so grouping keys on show_id', () => {
        expect(String(propertyOf('FlowsheetRangeResponse', 'entries')?.description)).toMatch(/Segment on `show_id`/);
      });

      it('warns that breakpoint rows land in the window before the hour they mark', () => {
        // add_time is the logging instant, ~1 min before the hour in
        // radio_hour — the BS#1448 / BS#1449 off-by-one-hour class.
        expect(rangeGet().description ?? '').toMatch(/radio_hour/);
      });

      it('envelopes shows and entries, both required', () => {
        expect(requiredKeysOf('FlowsheetRangeResponse').sort()).toEqual(['entries', 'shows']);
        expect(propertyOf('FlowsheetRangeResponse', 'entries')).toMatchObject({
          items: { $ref: '#/components/schemas/FlowsheetV2Entry' },
        });
        expect(propertyOf('FlowsheetRangeResponse', 'shows')).toMatchObject({
          items: { $ref: '#/components/schemas/FlowsheetRangeShow' },
        });
      });

      // The handler projects through projectEntriesV2, so a marker row carries
      // the marker's fields and not the track field set. The V1 row this
      // endpoint used to declare asserted the opposite (#487): one flat shape
      // with no entry_type, giving a talkset ~30 song fields it has never sent.
      it('declares the V2 union, not the flattened V1 row', () => {
        expect(spec.components.schemas.FlowsheetRangeEntry).toBeUndefined();
        expect(spec.components.schemas.FlowsheetRangeEntryBase).toBeUndefined();
        const union = spec.components.schemas.FlowsheetV2Entry as {
          oneOf?: Array<{ $ref?: string }>;
          discriminator?: { propertyName?: string; mapping?: Record<string, string> };
        };
        expect(union.discriminator?.propertyName).toBe('entry_type');
        // Every variant the union offers is reachable through the mapping —
        // an unmapped variant decodes as "unknown entry_type" on a client that
        // switches on the discriminator, which is the marker rows' failure mode.
        expect(Object.values(union.discriminator?.mapping ?? {}).sort()).toEqual(
          (union.oneOf ?? []).map((branch) => branch.$ref).sort()
        );
      });

      // iOS V2 decodes this endpoint and GET /flowsheet with one decoder
      // (tubafrenzy-decommissioning plan §2.5, consumer #3). Referencing the
      // same named union is what makes that structural: two inlined copies of
      // one union drift the moment a variant is added to only one of them.
      it('shares its entry union with GET /flowsheet, by reference', () => {
        const rangeItems = propertyOf('FlowsheetRangeResponse', 'entries')?.items as
          | { $ref?: string }
          | undefined;
        const paginatedItems = propertyOf('FlowsheetV2PaginatedResponse', 'entries')?.items as
          | { $ref?: string }
          | undefined;
        expect(rangeItems?.$ref).toBe('#/components/schemas/FlowsheetV2Entry');
        expect(paginatedItems?.$ref).toBe(rangeItems?.$ref);
      });

      // 20 of 2,619,011 rows have no linked show and Phase 0 decided against a
      // backfill, so the null reaches the wire of any read that can touch a
      // historical row. Consumers that group by show are the likely defect site.
      it('declares entries[].show_id nullable, present, and names the unattributed case', () => {
        const showId = propertyOf('FlowsheetV2Base', 'show_id');
        expect(showId?.type).toBe('integer');
        expect(showId?.nullable).toBe(true);
        expect(String(showId?.description)).toMatch(/unattributed/i);
        // Nullable value, still-present key — the `--strict-nullable` idiom.
        expect(requiredKeysOf('FlowsheetV2Base')).toContain('show_id');

        // The declaration is two hops from the endpoint — entries -> the union
        // -> a variant -> the base — so asserting it on the base alone would
        // still pass if a variant stopped composing the base and quietly
        // dropped show_id from this endpoint's rows. Identity, not equality:
        // each variant must reach THIS declaration, not a lookalike copy.
        const union = spec.components.schemas.FlowsheetV2Entry as {
          oneOf?: Array<{ $ref?: string }>;
        };
        expect(union.oneOf?.length).toBeGreaterThan(0);
        for (const branch of union.oneOf ?? []) {
          const variant = branch.$ref?.split('/').pop() as string;
          expect(propertyOf(variant, 'show_id'), `${variant} must reach FlowsheetV2Base`).toBe(
            showId
          );
          expect(requiredKeysOf(variant), variant).toContain('show_id');
        }
      });

      // Public, unauthenticated surface: the show projection carries the DJ's
      // handle, never a user id or the real-name column (BS#1371).
      it('projects shows without primary_dj_id, with a nullable resolved dj_name', () => {
        expect(propertyOf('FlowsheetRangeShow', 'primary_dj_id')).toBeUndefined();
        expect(propertyOf('FlowsheetRangeShow', 'dj_name')).toMatchObject({ type: 'string', nullable: true });
        expect(propertyOf('FlowsheetRangeShow', 'end_time')).toMatchObject({ nullable: true });
        expect(requiredKeysOf('FlowsheetRangeShow').sort()).toEqual(['id', 'start_time']);
      });
    });

    // The V2 union is referenced from four sites, so a field the projector
    // sends and the union omits is undeclared on every V2 read at once. These
    // three were sent and undeclared (#490).
    describe('FlowsheetV2TrackEntry declares what projectEntriesV2 sends (#490)', () => {
      it('declares label_id nullable — the wire sends null for unlinked labels', () => {
        // Not copied from FlowsheetEntryFields, which types this `integer` with
        // no `nullable`: `flowsheet.label_id` has no NOT NULL and the projector
        // passes it through, so a non-nullable declaration is wrong. Every
        // track row in the sampled production window carried null.
        expect(propertyOf('FlowsheetV2TrackEntry', 'label_id')).toMatchObject({
          type: 'integer',
          nullable: true,
        });
        expect(requiredKeysOf('FlowsheetV2TrackEntry')).not.toContain('label_id');
      });

      // Absent, never null or false, when the track resolved to no library row.
      // Marking it nullable would invite a consumer to read `null` as "known to
      // be available"; absence has to stay the only "unknown".
      it('declares discogsUnavailable as a non-nullable optional boolean', () => {
        const flag = propertyOf('FlowsheetV2TrackEntry', 'discogsUnavailable');
        expect(flag?.type).toBe('boolean');
        expect(flag?.nullable).toBeUndefined();
        expect(requiredKeysOf('FlowsheetV2TrackEntry')).not.toContain('discogsUnavailable');
      });

      it('declares discogsUnavailableNote nullable, optional, and length-capped', () => {
        expect(propertyOf('FlowsheetV2TrackEntry', 'discogsUnavailableNote')).toMatchObject({
          type: 'string',
          nullable: true,
          maxLength: 500,
        });
        expect(requiredKeysOf('FlowsheetV2TrackEntry')).not.toContain('discogsUnavailableNote');
      });

      // One writer emits both surfaces from one row, so a shape that differs
      // between them is a defect in one of the two by construction. Compared on
      // the wire-visible facets only: the descriptions differ on purpose.
      it.each(['discogsUnavailable', 'discogsUnavailableNote'])(
        'declares %s identically to the V1 field block',
        (field) => {
          const facets = (schema: string) => {
            const prop = propertyOf(schema, field) ?? {};
            return {
              type: prop.type,
              nullable: prop.nullable,
              maxLength: prop.maxLength,
            };
          };
          expect(facets('FlowsheetV2TrackEntry')).toEqual(facets('FlowsheetEntryFields'));
        }
      );

      // The V1 field block said this was "not emitted there yet" of the very
      // surface that now emits it. A contract that documents its own absence
      // has to stop saying so when the field arrives.
      it('no longer claims the V2 flowsheet does not carry the flag', () => {
        const v1 = String(propertyOf('FlowsheetEntryFields', 'discogsUnavailable')?.description);
        expect(v1).not.toMatch(/not emitted there yet/i);
      });
    });

    // `flowsheet.show_id` carries no NOT NULL and its FK is ON DELETE SET NULL,
    // and the table's own docblock lists NULL `show_id` first among the shapes
    // Backend-canonical writes must accept. The V1 identity block declared it
    // non-nullable anyway (#332), which makes a Swift decoder with a
    // non-optional Int throw rather than degrade on such a row.
    describe('FlowsheetEntryBase.show_id admits the unattributed row (#332)', () => {
      it('declares show_id nullable, and still required', () => {
        const showId = propertyOf('FlowsheetEntryBase', 'show_id');
        expect(showId?.type).toBe('integer');
        expect(showId?.nullable).toBe(true);
        expect(String(showId?.description)).toMatch(/unattributed/i);
        // Nullable value, still-present key — the `--strict-nullable` idiom.
        // Dropping it from `required` would be a different, wider break: the
        // key would become omissible, which the projector never does.
        expect(requiredKeysOf('FlowsheetEntryBase')).toContain('show_id');
      });

      // The V1 and V2 identity blocks describe the same column. They are
      // separate schemas for historical reasons, not because the column
      // differs, so a reader must not be able to conclude otherwise.
      it('agrees with FlowsheetV2Base on the shape of that column', () => {
        const v1 = propertyOf('FlowsheetEntryBase', 'show_id');
        const v2 = propertyOf('FlowsheetV2Base', 'show_id');
        expect({ type: v1?.type, nullable: v1?.nullable }).toEqual({
          type: v2?.type,
          nullable: v2?.nullable,
        });
        expect(requiredKeysOf('FlowsheetEntryBase')).toContain('show_id');
        expect(requiredKeysOf('FlowsheetV2Base')).toContain('show_id');
      });

      // Every schema composing the base inherits the fix. Asserted per
      // composer rather than on the base alone: a composer that stopped
      // reaching the base — or overrode show_id locally — would silently keep
      // the old shape while the base-only assertion above stayed green.
      it.each([
        'FlowsheetEntryResponse',
        'FlowsheetSongEntry',
        'FlowsheetShowBlockEntry',
        'FlowsheetMessageEntry',
        'FlowsheetBreakpointEntry',
      ])('%s resolves show_id to the nullable declaration', (schemaName) => {
        expect(propertyOf(schemaName, 'show_id')?.nullable).toBe(true);
        expect(propertyOf(schemaName, 'show_id')).toBe(
          propertyOf('FlowsheetEntryBase', 'show_id')
        );
      });
    });

    // `flowsheet.label_id` carries no NOT NULL, and null is the ordinary state
    // of the column rather than a rare one: every track row in the production
    // window sampled for the V2 half of this fix carried `label_id: null`. The
    // V2 declaration was corrected then; the two V1 read declarations were left
    // behind (#496), each naming a type that almost no row on the wire meets.
    describe('label_id admits the unlinked label on the V1 read shapes (#496)', () => {
      // Three independent declarations of one column: the v1 field block, the
      // v1 song shape's own inline copy, and the v2 track variant. Enumerated
      // rather than derived from one schema because the duplication is the
      // defect — each copy can drift alone, and two of them did.
      const READ_SITES = [
        'FlowsheetEntryFields',
        'FlowsheetSongEntry',
        'FlowsheetV2TrackEntry',
      ] as const;

      it.each(READ_SITES)('%s declares label_id nullable', (schemaName) => {
        const labelId = propertyOf(schemaName, 'label_id');
        expect(labelId?.type).toBe('integer');
        expect(labelId?.nullable).toBe(true);
      });

      // Structural rather than identity: these are three separate objects in
      // the document, so the pin has to compare shapes. Comparing as one map
      // keeps the failure legible — it names the site that drifted instead of
      // reporting `true !== undefined` from whichever assertion ran first.
      it('pins all three declarations to the same shape', () => {
        const declared = Object.fromEntries(
          READ_SITES.map((schemaName) => {
            const labelId = propertyOf(schemaName, 'label_id');
            return [schemaName, { type: labelId?.type, nullable: labelId?.nullable }];
          })
        );
        expect(declared).toEqual(
          Object.fromEntries(
            READ_SITES.map((schemaName) => [schemaName, { type: 'integer', nullable: true }])
          )
        );
      });

      // Whether the key is present is a separate question from whether its
      // value may be null, and none of the three has ever required it. Pinned
      // so that revisiting it has to be a decision about all three at once.
      it.each(READ_SITES)('%s leaves label_id optional', (schemaName) => {
        expect(requiredKeysOf(schemaName)).not.toContain('label_id');
      });

      // `FlowsheetEntryResponse` is the only composer of the v1 field block any
      // operation reaches — six of them, one being the SSE feed, where a
      // non-optional decode fails a live connection rather than one page.
      // Identity, not equality: it must resolve to the corrected declaration
      // itself and not to a local override that happens to agree today.
      it('FlowsheetEntryResponse resolves label_id to that declaration', () => {
        expect(propertyOf('FlowsheetEntryResponse', 'label_id')).toBe(
          propertyOf('FlowsheetEntryFields', 'label_id')
        );
      });

      // Deliberately not widened. These two are request bodies, where omitting
      // the field and sending an explicit null are different instructions: the
      // update path keys on `!== undefined`, so a null clears the column while
      // an absent key leaves it alone. Declaring them nullable would publish
      // "you may clear this" as part of this fix rather than as the decision it
      // is. Pinned so the question gets asked instead of assumed.
      it.each(['FlowsheetCreateSongFreeform', 'FlowsheetUpdateRequest'])(
        '%s keeps label_id non-nullable, being a request body',
        (schemaName) => {
          const labelId = propertyOf(schemaName, 'label_id');
          expect(labelId?.type).toBe('integer');
          expect(labelId?.nullable).toBeUndefined();
        }
      );
    });
  });

  describe('Catalog Schemas', () => {
    it('should define Artist', () => {
      expect(spec.components.schemas.Artist).toBeDefined();
    });

    it('should define Album', () => {
      expect(spec.components.schemas.Album).toBeDefined();
    });

    it('should define AlbumSearchResult', () => {
      expect(spec.components.schemas.AlbumSearchResult).toBeDefined();
    });

    it('should define AddAlbumRequest', () => {
      expect(spec.components.schemas.AddAlbumRequest).toBeDefined();
    });

    // Deleted, and asserted absent so they cannot return. None described a
    // response this API serves: track search is served by
    // `CatalogCompilationTrackRow` off /library/catalog/compilation-tracks,
    // artists by `Artist` off /library/artists, and genres by `GenreEntry` off
    // /library/genres. The query-parameter shapes (`TrackSearchParams`,
    // `CatalogSearchParams`) described no declared parameter, and the metadata
    // fetch pair no endpoint at all.
    //
    // `ArtistWithGenre` is the one worth knowing about: it carried a curated
    // description naming GET /library/genres as authoritative, which reads as
    // maintenance on a live schema. It was a documentation pass that applied
    // the same sentence to every `genre_name` it found; the copy that mattered
    // landed on `AlbumDetail` and is still asserted below. Curation is not
    // evidence of a consumer.
    it.each([
      'TrackSearchResult',
      'TrackSearchParams',
      'CatalogSearchParams',
      'ArtistWithGenre',
      'MetadataFetchRequest',
      'MetadataFetchResponse',
    ])('does not define %s', (name) => {
      expect(spec.components.schemas).not.toHaveProperty(name);
    });
  });

  // BS#1281 (Not-on-Discogs 1a) read fields + BS#1154 PATCH /library/:id
  // contract catch-up (wxyc-shared#156). BS#1154 shipped the endpoint and its
  // wire-level request type in Backend-Service code without ever propagating
  // the schema here — this closes that gap, matching the SHIPPED server
  // (apps/backend/controllers/library.controller.ts `UpdateAlbumRequest` +
  // `UPDATABLE_ALBUM_FIELDS`) exactly, not an idealized/renamed shape.
  describe('Discogs-Unavailable Album fields + UpdateAlbumRequest (BS#1281 / BS#1154 / #156)', () => {
    type SchemaProp = {
      type?: string;
      nullable?: boolean;
      format?: string;
      maxLength?: number;
      minimum?: number;
      maximum?: number;
      default?: unknown;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };

    it('Album gains discogsUnavailable as a boolean', () => {
      const schema = spec.components.schemas.Album as Schema;
      const prop = schema.properties?.discogsUnavailable;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('boolean');
      expect(schema.required ?? []).not.toContain('discogsUnavailable');
    });

    it('Album gains discogsUnavailableNote as a nullable string capped at 500 chars', () => {
      const schema = spec.components.schemas.Album as Schema;
      const prop = schema.properties?.discogsUnavailableNote;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('string');
      expect(prop?.nullable).toBe(true);
      expect(prop?.maxLength).toBe(500);
      expect(schema.required ?? []).not.toContain('discogsUnavailableNote');
    });

    it('Album gains lastDiscogsRecheckAt as a nullable date-time string (server-write-only)', () => {
      const schema = spec.components.schemas.Album as Schema;
      const prop = schema.properties?.lastDiscogsRecheckAt;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('string');
      expect(prop?.format).toBe('date-time');
      expect(prop?.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('lastDiscogsRecheckAt');
    });

    it('defines UpdateAlbumRequest matching BS wire format exactly: 13 fields, all optional, no `required` list', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      expect(schema).toBeDefined();
      expect(schema.required ?? []).toEqual([]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        [
          'album_title',
          'label',
          'label_id',
          'genre_id',
          'format_id',
          'artist_id',
          'alternate_artist_name',
          // BS#2004: writable on PATCH since Backend opened the column.
          'album_artist',
          'disc_quantity',
          'code_number',
          'code_volume_letters',
          'discogsUnavailable',
          'discogsUnavailableNote',
        ].sort(),
      );
    });

    it('UpdateAlbumRequest keeps the 8 legacy fields snake_case, matching AddAlbumRequest / BS wire keys', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      const props = schema.properties ?? {};
      expect(props.album_title?.type).toBe('string');
      expect(props.label?.type).toBe('string');
      // BS wire type: `label?: string` — NOT nullable, unlike Album.label's DB column.
      expect(props.label?.nullable).toBeUndefined();
      expect(props.label_id?.type).toBe('integer');
      expect(props.label_id?.nullable).toBe(true);
      expect(props.genre_id?.type).toBe('integer');
      expect(props.format_id?.type).toBe('integer');
      expect(props.artist_id?.type).toBe('integer');
      expect(props.alternate_artist_name?.type).toBe('string');
      // BS#2004: nullable like alternate_artist_name — `null` clears the credit.
      expect(props.album_artist?.type).toBe('string');
      expect(props.album_artist?.nullable).toBe(true);
      expect(props.alternate_artist_name?.nullable).toBe(true);
      expect(props.disc_quantity?.type).toBe('integer');
    });

    it('UpdateAlbumRequest carries the two discogs fields camelCase, matching the whitelist BS actually reads', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      const props = schema.properties ?? {};
      expect(props.discogsUnavailable?.type).toBe('boolean');
      expect(props.discogsUnavailableNote?.type).toBe('string');
      expect(props.discogsUnavailableNote?.nullable).toBe(true);
      expect(props.discogsUnavailableNote?.maxLength).toBe(500);
    });

    it('UpdateAlbumRequest omits lastDiscogsRecheckAt (server-write-only, never client-supplied)', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      expect(schema.properties?.lastDiscogsRecheckAt).toBeUndefined();
    });

    it('UpdateAlbumRequest omits artist_name (server-derived on the ALBUM body; UPDATABLE_ALBUM_FIELDS never reads it from this body)', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      expect(schema.properties?.artist_name).toBeUndefined();
    });

    it('UpdateAlbumRequest carries code_number and code_volume_letters as writable (BS#2564)', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      const props = schema.properties ?? {};
      expect(props.code_number?.type).toBe('integer');
      expect(props.code_number?.minimum).toBe(1);
      expect(props.code_number?.maximum).toBe(32767);
      expect(props.code_volume_letters?.type).toBe('string');
      expect(props.code_volume_letters?.nullable).toBe(true);
      expect(props.code_volume_letters?.maxLength).toBe(4);
    });

    it('declares PATCH /library/{id} under BearerAuth, referencing UpdateAlbumRequest and returning AlbumSearchResult', () => {
      const path = spec.paths['/library/{id}'] as {
        patch?: {
          security?: Array<Record<string, unknown[]>>;
          parameters?: Array<{ name: string; in: string; schema?: { type?: string } }>;
          requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };
      expect(path).toBeDefined();
      expect(path.patch).toBeDefined();
      expect(path.patch!.security).toEqual([{ BearerAuth: [] }]);

      const idParam = path.patch!.parameters?.find((p) => p.name === 'id');
      expect(idParam?.in).toBe('path');
      expect(idParam?.schema?.type).toBe('integer');

      expect(path.patch!.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/UpdateAlbumRequest',
      );
      // Matches libraryController.updateAlbum, which returns
      // libraryService.getAlbumFromDB() — the same call markMissing/markFound
      // and GET /library/info use. This said AlbumSearchResult until #365
      // pointed all four at the one shape they actually share.
      expect(path.patch!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/AlbumDetail',
      );
      expect(path.patch!.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse',
      );
    });
  });

  // wxyc-shared#285 (AlbumMetadataResponse) and #282 (AlbumSearchResult)
  // propagate the discogsUnavailable trio Album already carries (#156) to the
  // two render surfaces that were missing it: GET /proxy/metadata/album and
  // catalog-search results. FlowsheetEntryResponse gains a partial slice
  // (discogsUnavailable + discogsUnavailableNote, deliberately camelCase amid
  // its snake_case metadata siblings, no lastDiscogsRecheckAt) as the api.yaml
  // piece of Backend-Service#1908 — the BS-emit and dj-site-render pieces stay
  // open there. All additive/optional; no existing field's shape changes.
  describe('discogsUnavailable trio on AlbumMetadataResponse / AlbumSearchResult / FlowsheetEntryResponse (#285 / #282 / BS#1908)', () => {
    type SchemaProp = {
      type?: string;
      nullable?: boolean;
      format?: string;
      maxLength?: number;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };

    describe('AlbumMetadataResponse (#285)', () => {
      it('gains discogsUnavailable as a boolean', () => {
        const schema = spec.components.schemas.AlbumMetadataResponse as Schema;
        const prop = schema.properties?.discogsUnavailable;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('boolean');
        expect(schema.required ?? []).not.toContain('discogsUnavailable');
      });

      it('gains discogsUnavailableNote as a nullable string capped at 500 chars', () => {
        const schema = spec.components.schemas.AlbumMetadataResponse as Schema;
        const prop = schema.properties?.discogsUnavailableNote;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(prop?.nullable).toBe(true);
        expect(prop?.maxLength).toBe(500);
      });

      it('gains lastDiscogsRecheckAt as a nullable date-time string, matching Album verbatim', () => {
        const schema = spec.components.schemas.AlbumMetadataResponse as Schema;
        const prop = schema.properties?.lastDiscogsRecheckAt;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(prop?.format).toBe('date-time');
        expect(prop?.nullable).toBe(true);
        expect(schema.required ?? []).not.toContain('lastDiscogsRecheckAt');
      });
    });

    describe('AlbumSearchResult (#282)', () => {
      it('gains discogsUnavailable as a boolean, matching Album shape', () => {
        const schema = spec.components.schemas.AlbumSearchResult as Schema;
        const albumSchema = spec.components.schemas.Album as Schema;
        const prop = schema.properties?.discogsUnavailable;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe(albumSchema.properties?.discogsUnavailable?.type);
        expect(prop?.nullable).toBe(albumSchema.properties?.discogsUnavailable?.nullable);
        expect(schema.required ?? []).not.toContain('discogsUnavailable');
      });

      it('gains discogsUnavailableNote as a nullable string capped at 500 chars', () => {
        const schema = spec.components.schemas.AlbumSearchResult as Schema;
        const prop = schema.properties?.discogsUnavailableNote;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(prop?.nullable).toBe(true);
        expect(prop?.maxLength).toBe(500);
      });

      it('gains lastDiscogsRecheckAt as a nullable date-time string', () => {
        const schema = spec.components.schemas.AlbumSearchResult as Schema;
        const prop = schema.properties?.lastDiscogsRecheckAt;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(prop?.format).toBe('date-time');
        expect(prop?.nullable).toBe(true);
      });
    });

    describe('FlowsheetEntryResponse (api.yaml piece of Backend-Service#1908)', () => {
      const getProperty = (prop: string): SchemaProp | undefined =>
        propertyOf('FlowsheetEntryResponse', prop) as SchemaProp | undefined;

      it('gains discogsUnavailable as a non-nullable boolean matching the other Album surfaces, camelCase deliberately unlike its snake_case siblings', () => {
        const prop = getProperty('discogsUnavailable');
        const albumSchema = spec.components.schemas.Album as Schema;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('boolean');
        // Non-nullable, exactly as Album/AlbumSearchResult/AlbumMetadataResponse
        // declare it (the BS `withDiscogsUnavailableCamelCase` serializer types
        // it as a non-null boolean).
        expect(prop?.nullable).toBeUndefined();
        expect(prop?.nullable).toBe(albumSchema.properties?.discogsUnavailable?.nullable);
      });

      it('gains discogsUnavailableNote as a nullable string capped at 500 chars', () => {
        const prop = getProperty('discogsUnavailableNote');
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(prop?.nullable).toBe(true);
        expect(prop?.maxLength).toBe(500);
      });

      it('does not add lastDiscogsRecheckAt (BS#1908 tracks the BS-emit + dj-site-render pieces separately)', () => {
        const prop = getProperty('lastDiscogsRecheckAt');
        expect(prop).toBeUndefined();
      });
    });
  });

  // #340. dj-site's tracklist reads resolve in the legacy_release_id space
  // (dj-site#1179), but none of catalog/bin/rotation carried that field, so
  // the client couldn't send the right id. Adds legacy_release_id to all four
  // response surfaces in one pass (partial coverage leaves the dj-site fix
  // unimplementable for bin/rotation rows), and track_position to the
  // freeform flowsheet-create branch (LML-only rows with no library linkage
  // still carry a Discogs release_track.position).
  describe('legacy_release_id + track_position (#340)', () => {
    type SchemaProp = {
      type?: string;
      nullable?: boolean;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };

    describe('legacy_release_id', () => {
      it('is optional on AlbumSearchResult, non-nullable', () => {
        const schema = spec.components.schemas.AlbumSearchResult as Schema;
        const prop = schema.properties?.legacy_release_id;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('integer');
        expect(prop?.nullable).toBeUndefined();
        expect(schema.required ?? []).not.toContain('legacy_release_id');
      });

      it('is optional on BinLibraryDetails, non-nullable', () => {
        const schema = spec.components.schemas.BinLibraryDetails as Schema;
        const prop = schema.properties?.legacy_release_id;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('integer');
        expect(prop?.nullable).toBeUndefined();
        expect(schema.required ?? []).not.toContain('legacy_release_id');
      });

      it('is optional and nullable on Rotation (library-unlinked rows have no legacy id)', () => {
        const schema = spec.components.schemas.Rotation as Schema;
        const prop = schema.properties?.legacy_release_id;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('integer');
        expect(prop?.nullable).toBe(true);
        expect(schema.required ?? []).not.toContain('legacy_release_id');
      });

      it('is optional on AlbumDetail (allOf-composed), non-nullable', () => {
        const prop = propertyOf('AlbumDetail', 'legacy_release_id') as SchemaProp | undefined;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('integer');
        expect(prop?.nullable).toBeUndefined();
        expect(requiredKeysOf('AlbumDetail')).not.toContain('legacy_release_id');

        // propertyOf() walks every allOf branch and returns the first match,
        // so the assertions above alone can't distinguish "declared on this
        // response's own branch" from "hoisted onto the shared Album base" --
        // which every other Album consumer (e.g. POST /library's 200
        // response) would then inherit too. Pin the placement directly:
        // AlbumDetail is flat, so this is a direct property. Album is the RAW
        // row POST /library returns and must NOT carry it -- the two schemas
        // deliberately no longer compose (see AlbumDetail's own description).
        const albumDetail = spec.components.schemas.AlbumDetail as {
          properties: Record<string, SchemaProp>;
        };
        expect(albumDetail.properties.legacy_release_id).toBeDefined();
        expect(albumDetail.properties.legacy_release_id!.type).toBe('integer');
        expect(propertyOf('Album', 'legacy_release_id')).toBeUndefined();
      });
    });

    describe('track_position', () => {
      it('is declared as an optional string on FlowsheetCreateSongFreeform', () => {
        const schema = spec.components.schemas.FlowsheetCreateSongFreeform as Schema;
        const prop = schema.properties?.track_position;
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('string');
        expect(schema.required ?? []).not.toContain('track_position');
      });

      it('drops the now-inaccurate "no resolvable identity" clause from FlowsheetCreateSongFromCatalog', () => {
        const prop = propertyOf('FlowsheetCreateSongFromCatalog', 'track_position');
        expect(String(prop?.description)).not.toMatch(/no resolvable identity/);
      });

      // Read-side mirror of the write-side clause above: freeform (LML-only)
      // rows can now carry a real track_position through
      // FlowsheetCreateSongFreeform, so "no resolvable identity" is no
      // longer a valid null-case on the V2 read response either.
      it('drops the now-inaccurate "no resolvable identity" clause from FlowsheetV2TrackEntry', () => {
        const prop = propertyOf('FlowsheetV2TrackEntry', 'track_position');
        expect(String(prop?.description)).not.toMatch(/no resolvable identity/);
      });
    });
  });

  // #383. AlbumSearchResult identified an artist by name and shelf code only,
  // so no catalog-search consumer could link a result row to that artist's
  // page. Optional, not required: it lands ahead of the Backend-Service
  // change that populates it (WXYC/Backend-Service#2227), so a consumer
  // compiled against the new package must still tolerate its absence until
  // that deploys.
  describe('AlbumSearchResult.artist_id (#383)', () => {
    type SchemaProp = {
      type?: string;
      description?: string;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };

    it('is declared as an optional integer, describing the shared library.artist_id keyspace', () => {
      const schema = spec.components.schemas.AlbumSearchResult as Schema;
      const prop = schema.properties?.artist_id;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('integer');
      expect(schema.required ?? []).not.toContain('artist_id');
      expect(String(prop?.description)).toMatch(/library\.artist_id/);
    });
  });

  describe('AlbumSearchResult.label admits the unlabeled release (#140)', () => {
    it('declares label nullable, and still required', () => {
      const label = propertyOf('AlbumSearchResult', 'label');
      expect(label?.type).toBe('string');
      expect(label?.nullable).toBe(true);
      // Nullable value, still-present key -- the `--strict-nullable` idiom.
      // `library.label` carries no NOT NULL, and GET /library projects the
      // column straight through with no COALESCE, so a real row reaches the
      // wire with `label: null`. GET /library/query coalesces it to `""`
      // instead, in both of its mappers -- but the two operations share this
      // one schema and OpenAPI cannot narrow a shared schema per operation,
      // so the declaration admits the wider of the two shapes. Dropping it
      // from `required` would be a different, wider break: no producer omits
      // the key.
      //
      // Pinned as a closed set rather than one `toContain` per field: that
      // also catches a key being ADDED to `required`, which containment
      // checks cannot.
      expect(requiredKeysOf('AlbumSearchResult').sort()).toEqual(
        [
          'id',
          'add_date',
          'album_title',
          'artist_name',
          'code_letters',
          'code_number',
          'code_artist_number',
          'format_name',
          'genre_name',
          'label',
        ].sort()
      );
    });

    // The document contradicted itself before this: four other schemas
    // describing the same `library.label` column already declared it
    // nullable, so one column had two declared shapes and a consumer could
    // believe either. Pinned to each other so they cannot drift apart again.
    it.each(['AlbumDetail', 'LibraryCatalogItem', 'LibrarySearchItem', 'CatalogExportRow'])(
      'agrees with %s on the shape of library.label',
      (sibling) => {
        const search = propertyOf('AlbumSearchResult', 'label');
        const other = propertyOf(sibling, 'label');
        expect({ type: other?.type, nullable: other?.nullable }).toEqual({
          type: search?.type,
          nullable: search?.nullable,
        });
      }
    );

    // `AlbumDetail` is the exact precedent: the same column, also on a read
    // surface, required-and-nullable already. The three siblings above are
    // nullable but optional -- `CatalogExportRow` omits its nullable keys
    // from `required` deliberately. Both idioms are defensible; this one
    // follows the schema whose `required` list is otherwise identical.
    it('follows AlbumDetail in keeping the key required', () => {
      expect(requiredKeysOf('AlbumDetail')).toContain('label');
    });

    // Every other field in that `required` list is sourced from a NOT NULL
    // column. `id`, `code_number`, `album_title` and `add_date` come off
    // `library` itself; `code_letters`, `artist_name`, `format_name`,
    // `genre_name` and `code_artist_number` arrive through
    // `library_artist_view`'s INNER JOINs onto artists, format, genres and
    // genre_artist_crossreference, so a row that survives those joins cannot
    // carry a null in any of them. Only `label` is a nullable column on the
    // base table. One trap when re-auditing: Backend-Service has TWO
    // `artist_name` columns with opposite nullability, and the wire field is
    // the NOT NULL `artists.artist_name`, not the nullable denormalized
    // `library.artist_name` that is only ever read in WHERE/ORDER BY.
    // Table-tested together so a future widening pass has to overturn this
    // decision once, in one place, rather than losing it one assertion at a
    // time.
    it.each([
      'id',
      'add_date',
      'album_title',
      'artist_name',
      'code_letters',
      'code_number',
      'code_artist_number',
      'format_name',
      'genre_name',
    ])('leaves %s non-nullable', (field) => {
      const prop = propertyOf('AlbumSearchResult', field);
      // Asserted separately because `undefined?.nullable` is `undefined`:
      // without this the nullability check passes for a property that was
      // deleted outright, which the closed-set `required` pin above would
      // not catch either (`required` is a separate list, and a required key
      // with no schema is a real break).
      expect(prop).toBeDefined();
      expect(prop?.nullable).toBeUndefined();
    });
  });

  describe('AlbumSearchResult.label_id and album_artist admit their genuine nulls (#140)', () => {
    // Same producer-side shape as `label` above, for the two other
    // `library` columns sitting one and three lines away in the schema:
    // `library.label_id` and `library.album_artist` carry no NOT NULL
    // (`shared/database/src/schema.ts`), `library_artist_view`'s latest
    // definition (migration 0166) selects both straight off the base
    // `library` FROM table with no COALESCE, and neither `/library/query`
    // mapper (`taggedRowToAlbumSearchResultRow` / `toAlbumSearchResultRow` in
    // `library-search.service.ts`) nor the `GET /library` serializer
    // (`serializeLibraryArtistViewEntry` in `library.service.ts`) coalesces
    // either field -- both pass the row value through unchanged, so a real
    // unlabeled / non-compilation row reaches the wire with a genuine null.
    //
    // Unlike `label`, neither field is in `required` today, so admitting the
    // null is a narrower fix than `label`'s: only `nullable: true`.
    // Promoting either to `required` would be the separate, wider "the key
    // is always present" claim that `legacy_release_id`'s description says
    // needs its own per-projection audit, not a text edit alongside this fix.
    it('declares label_id nullable, staying out of required', () => {
      const prop = propertyOf('AlbumSearchResult', 'label_id');
      expect(prop?.type).toBe('integer');
      expect(prop?.nullable).toBe(true);
      expect(requiredKeysOf('AlbumSearchResult')).not.toContain('label_id');
    });

    it('declares album_artist nullable, staying out of required', () => {
      const prop = propertyOf('AlbumSearchResult', 'album_artist');
      expect(prop?.type).toBe('string');
      expect(prop?.nullable).toBe(true);
      expect(requiredKeysOf('AlbumSearchResult')).not.toContain('album_artist');
    });
  });

  describe('on_streaming nullability (#127)', () => {
    it.each(['AlbumSearchResult', 'LibraryCatalogItem'])(
      '%s declares on_streaming nullable, matching its own "Null if unknown" wording',
      (schemaName) => {
        const prop = propertyOf(schemaName, 'on_streaming');
        expect(prop?.type).toBe('boolean');
        expect(prop?.nullable).toBe(true);
        expect(String(prop?.description)).toMatch(/null if unknown/i);
      }
    );

    // The document-wide sweep this fix is asked to do: no schema may expose
    // `on_streaming` as non-nullable. Deliberately NOT keyed on the
    // description saying "null" -- that filter would exempt the one
    // declaration carrying no description at all (LibrarySearchItem's),
    // letting it silently lose the flag. The property is tri-state
    // everywhere it appears, so the flag is the invariant and the prose is
    // only evidence for it.
    //
    // Walked over the parsed tree rather than the raw YAML text because
    // `propertyOf` already follows inline `allOf` branches, which is where
    // FlowsheetV2TrackEntry's declaration lives, so no special-casing is
    // needed; a text scan would also couple this assertion to formatting,
    // and these descriptions are byte-identical across two schemas -- the
    // exact condition that produced the `&streaming-url-note-album` anchor
    // elsewhere in this document, which a text scan would stop matching.
    //
    // The site list is pinned as a closed set so a new declaration fails
    // naming the schema rather than reporting a bare count mismatch.
    it('every schema declaring on_streaming declares it nullable', () => {
      const sites = Object.keys(spec.components.schemas).filter((name) =>
        propertyOf(name, 'on_streaming')
      );
      expect(sites.sort()).toEqual(
        [
          'AlbumDetail',
          'AlbumSearchResult',
          'CatalogExportRow',
          'FlowsheetV2TrackEntry',
          'LibraryCatalogItem',
          'LibrarySearchItem',
          'StreamingCheckResponse',
        ].sort()
      );
      for (const name of sites) {
        expect(propertyOf(name, 'on_streaming')?.nullable, name).toBe(true);
      }
      // Coverage check on the walk itself, not a second assertion of the
      // invariant: a declaration written inline under `paths:` sits outside
      // `components.schemas` and no name-keyed walk can reach it. Matching
      // only the key line keeps this immune to how the block below it is
      // formatted.
      //
      // Compared against LOCAL declarations, not `sites.length`. `sites` is
      // built from `propertyOf`, which follows `allOf`'s `$ref` branches —
      // so a schema that composes an on_streaming-bearing schema via
      // `allOf: [$ref: ...]` (with no local copy of its own) inflates
      // `sites` past the physical line count without adding a line, and
      // `sites.length` would then legitimately disagree with the raw scan
      // for a reason this assertion's own comment doesn't describe. Each
      // schema counted here writes the property into its own YAML body
      // (`declaresPropertyLocally`), so the count is 1:1 with physical
      // `on_streaming:` lines regardless of how many other schema names
      // later inherit it via composition.
      const localSites = Object.keys(spec.components.schemas).filter((name) =>
        declaresPropertyLocally(name, 'on_streaming')
      );
      expect([...specText.matchAll(/^ *on_streaming:$/gm)]).toHaveLength(localSites.length);
    });
  });

  // #373. Both remaining `legacy_release_id` descriptions justified staying
  // optional by citing "the live openapi-compliance deploy gate". That names a
  // detector, not a reason — and the detector does not hold up either way it
  // is read. `e2e/contract/openapi-compliance.test.ts` is real, but the only
  // thing that ever runs it against a deployed stack is `bs-lml-gate.yml`,
  // which has never fired once; and even if it fired, it validates
  // `AlbumSearchResult` (via GET /library) and never `BinLibraryDetails`. So
  // the citation was load-bearing for a reader — "a gate exists, sequence the
  // publish around it" — while being unable to justify half the sites that
  // carried it.
  //
  // The real reason sits upstream of any detector: `legacy_release_id` is
  // emitted per-projection, not globally. `library.legacy_release_id` is NOT
  // NULL in the database, but that is a claim about the column, while
  // `required` in OpenAPI is a promise the key appears on the wire. Those come
  // apart today: WXYC/Backend-Service#2167 is open precisely because the LML
  // search-proxy rows behind `AlbumSearchResult` do not emit the column
  // explicitly yet. Promoting either property now would be a promise the
  // server does not keep on every path that returns these schemas.
  //
  // Scope for the negative half is the whole spec text rather than these two
  // descriptions. The citation is copy-paste-shaped — it stood in three places
  // until #365 rewrote `AlbumInfoResponse` into `AlbumDetail` and dropped the
  // third — so a guard that reads only the two known sites would watch it
  // reappear somewhere else in silence.
  describe('legacy_release_id optionality is justified per-projection, not by a deploy gate (#373)', () => {
    const SITES = ['AlbumSearchResult', 'BinLibraryDetails'] as const;

    function justification(schemaName: string): string {
      return String(propertyOf(schemaName, 'legacy_release_id')?.description ?? '');
    }

    it('cites the openapi-compliance gate nowhere in the spec', () => {
      expect(specText).not.toMatch(/openapi-compliance/i);
    });

    it.each(SITES)('%s justifies optionality without appealing to a gate', (schemaName) => {
      expect(justification(schemaName)).not.toMatch(/\bgate\b/i);
    });

    // The positive half. Deleting the false clause and leaving nothing behind
    // would pass every assertion above while losing the fact this change
    // exists to record — the same failure mode #365 left here to be fixed.
    it.each(SITES)('%s names the per-projection emit as the reason', (schemaName) => {
      const description = justification(schemaName);
      expect(description).toMatch(/per-projection/i);
      // The wire-vs-column distinction is the whole argument; without it the
      // NOT NULL clause reads as an argument FOR `required`.
      expect(description).toMatch(/wire/i);
      // And the ticket whose closure unblocks the promotion, so the follow-up
      // stays traceable from the spec rather than only from #373.
      expect(description).toMatch(/Backend-Service#2167/);
    });

    it('states the reason in identical wording at both sites, so a reader sees one rule', () => {
      const [first, ...rest] = SITES.map(justification);
      expect(first).not.toBe('');
      for (const other of rest) expect(other).toBe(first);
    });

    it.each(SITES)('leaves legacy_release_id optional on %s (promotion is gated on BS#2167)', (schemaName) => {
      expect(requiredKeysOf(schemaName)).not.toContain('legacy_release_id');
    });
  });

  // wxyc-shared#318. WXYC/Backend-Service#1827 (merged as #1838) added three
  // "local-first base fields" to GET /proxy/metadata/album — durable BS state
  // read off the linked flowsheet row, so an LML timeout can blank
  // `artworkUrl` but can never blank artist/track/album/label — and never
  // contracted them here. Undeclared field names are absent from every
  // generated client, so the non-blankable guarantee was invisible to every
  // consumer. All three are conditionally assigned in BS
  // (`if (linkedRow?.record_label)`, `if (linkedRow?.label_id != null)`,
  // `if (linkedRow?.metadata_status)`), so all three are optional: a free-text
  // row that never linked to an `album_id` has no local source and the
  // response omits them.
  describe('local-first base fields on AlbumMetadataResponse (#318 / BS#1827)', () => {
    type SchemaProp = {
      type?: string;
      nullable?: boolean;
      description?: string;
      $ref?: string;
      allOf?: Array<{ $ref?: string }>;
      enum?: string[];
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };

    function albumMetadataResponse(): Schema {
      return spec.components.schemas.AlbumMetadataResponse as Schema;
    }

    it('declares recordLabel as an optional string', () => {
      const schema = albumMetadataResponse();
      const prop = schema.properties?.recordLabel;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('string');
      expect(schema.required ?? []).not.toContain('recordLabel');
    });

    it('declares labelId as an optional integer', () => {
      const schema = albumMetadataResponse();
      const prop = schema.properties?.labelId;
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('integer');
      expect(schema.required ?? []).not.toContain('labelId');
    });

    it('declares metadataStatus as optional and $refs the shared MetadataStatus enum rather than inlining the literals', () => {
      const schema = albumMetadataResponse();
      const prop = schema.properties?.metadataStatus;
      expect(prop).toBeDefined();
      expect(schema.required ?? []).not.toContain('metadataStatus');
      // An `allOf` wrapper around the single $ref is how this spec attaches a
      // description to a referenced schema under OpenAPI 3.0, where sibling
      // keys next to `$ref` are ignored (see FlowsheetV2TrackEntry's
      // `upcoming_show`). The point is that the literals live in exactly one
      // place, so this property and the flowsheet V2 entry cannot drift.
      const refs = [prop?.$ref, ...(prop?.allOf ?? []).map((branch) => branch.$ref)];
      expect(refs).toContain('#/components/schemas/MetadataStatus');
      expect(prop?.enum).toBeUndefined();
    });

    it('reaches the same enum the V2 flowsheet track entry uses', () => {
      const metadataStatus = spec.components.schemas.MetadataStatus as SchemaProp;
      expect(metadataStatus.enum).toEqual([
        'pending',
        'enriching',
        'enriched_match',
        'enriched_no_match',
        'failed_no_retry',
      ]);
      // The V2 track entry reaches the same schema; both consumers of the enum
      // move together because neither owns a copy of the literals.
      const v2Track = spec.components.schemas.FlowsheetV2TrackEntry as {
        allOf?: Array<{ properties?: Record<string, SchemaProp> }>;
      };
      const v2Prop = (v2Track.allOf ?? [])
        .map((branch) => branch.properties?.metadata_status)
        .find((candidate) => candidate !== undefined);
      expect(v2Prop?.$ref).toBe('#/components/schemas/MetadataStatus');
    });

    it('documents each base field with its provenance and the condition under which BS omits it', () => {
      const schema = albumMetadataResponse();
      for (const name of ['recordLabel', 'labelId', 'metadataStatus'] as const) {
        const description = schema.properties?.[name]?.description ?? '';
        expect(description, `${name} needs a description`).not.toBe('');
        // Provenance: the linked flowsheet row, not Discogs/LML.
        expect(description, `${name} must cite the linked flowsheet row`).toMatch(/flowsheet row/i);
        // Omission condition: BS only assigns when a linked row supplies it.
        expect(description, `${name} must state when BS omits it`).toMatch(/omitted/i);
      }
    });

    it('keeps recordLabel distinct from label, naming the other in both descriptions', () => {
      const schema = albumMetadataResponse();
      const recordLabel = schema.properties?.recordLabel?.description ?? '';
      const label = schema.properties?.label?.description ?? '';
      // Merging the two would destroy the local-first guarantee: `label` is the
      // Discogs *release* label (album_metadata or an LML fallthrough) and is
      // still NULL on pre-BS#1336 rows (BS#1442), while `recordLabel` is the
      // catalog label BS wrote at play time.
      expect(recordLabel).toMatch(/`label`/);
      expect(label).toMatch(/`recordLabel`/);
    });

    it('notes on MetadataStatus that AlbumMetadataResponse shares it', () => {
      const metadataStatus = spec.components.schemas.MetadataStatus as SchemaProp;
      expect(metadataStatus.description ?? '').toMatch(/AlbumMetadataResponse/);
    });

    // The base-field read lives in the cache-MISS arm of the handler
    // (proxy.controller.ts L660-668). On a hit the handler does
    // `Object.assign(metadata, cachedEnrichment)` and never calls
    // `selectLinkedFlowsheetRow` — and these three ARE memoized, because
    // ALBUM_METADATA_BASE_FIELDS (L526) excludes only the request-echoed
    // artistName/releaseTitle/trackTitle. So "read off the linked row on every
    // request" is false, and a contract that implies it would declare a real
    // production state impossible: for up to the 1h TTL after a DJ links a
    // previously free-text play, the response can still omit all three.
    it('documents the 1h memo, so the contract does not imply a fresh row read on every request', () => {
      const description = (albumMetadataResponse() as { description?: string }).description ?? '';
      expect(description).toMatch(/1h|one hour|TTL/i);
      expect(description).toMatch(/cach|memo/i);
      // The claim that must NOT survive: an unqualified "before any upstream
      // lookup" reads as "on every request", which the cache-hit arm falsifies.
      expect(description).not.toMatch(/before any upstream lookup is attempted/i);
    });

    it('scopes the base tier to all six fields BS treats as base, not just the three declared here', () => {
      const description = (albumMetadataResponse() as { description?: string }).description ?? '';
      // proxy.controller.ts L577-595 and L604-612 put artistName/releaseTitle/
      // trackTitle in the same tier — artistName unconditionally. Declaring
      // them is follow-up work, but this prose is the first place the contract
      // *defines* the tier, so it must not define it by omission.
      for (const name of ['artistName', 'releaseTitle', 'trackTitle']) {
        expect(description, `base tier must name ${name}`).toMatch(new RegExp(`\`${name}\``));
      }
    });

    it('does not claim metadataStatus is omitted for a null column, which the NOT NULL default makes unreachable', () => {
      const description = albumMetadataResponse().properties?.metadataStatus?.description ?? '';
      // Backend-Service/shared/database/src/schema.ts:1046 declares
      // `metadata_status` .notNull().default('pending'), so a linked row always
      // has a value. The recordLabel/labelId equivalents ARE reachable.
      expect(description).toMatch(/NOT NULL/i);
      expect(description).not.toMatch(/`metadata_status` is null/i);
    });

    it('states the memo as an omission path on each of the three fields', () => {
      const schema = albumMetadataResponse();
      for (const name of ['recordLabel', 'labelId', 'metadataStatus'] as const) {
        const description = schema.properties?.[name]?.description ?? '';
        expect(description, `${name} must name the memo as an omission path`).toMatch(/memo|cach/i);
      }
    });
  });

  // GET /library/catalog (the gzipped-NDJSON bulk export) and its row shape
  // shipped in Backend-Service#1468 (Epic F, parent #1466) but were never
  // propagated to this cross-repo SSOT — only to BS's local Swagger-only
  // app.yaml. These tests pin the reconciliation: the export row is its own
  // schema (NOT a superset of AlbumSearchResult), rotation is raw, and all four
  // catalog GET reads share the `catalog:read` auth the routes enforce.
  describe('Catalog Export (BS#1468 / Epic F #1466)', () => {
    type Schema = {
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
      allOf?: unknown;
    };

    // The catalog-export projection (Backend-Service catalog-export.service.ts,
    // CatalogExportRow). The SSOT LEADS the consumer: this list is 19 fields,
    // four ahead of that private type until BS#1965 adds the library.db-producer
    // fields (legacy_release_id, alternate_artist_name, album_artist,
    // cross_reference_names).
    //
    // That lead is a live constraint on Backend-Service, not just a note. BS's
    // parity guard (BS#1477, tests/unit/services/catalog-export.parity.test.ts)
    // asserts privateKeys == ssotKeys against the INSTALLED @wxyc/shared, so the
    // first BS PR that bumps this package past this release fails that test —
    // including an unrelated Dependabot bump. BS#1965 must land in the same bump,
    // or BS CI stays red. Do not delete this note until the lead is closed.
    const EXPORT_FIELDS = [
      'id',
      'legacy_release_id',
      'artist_name',
      'alternate_artist_name',
      'album_artist',
      'cross_reference_names',
      'album_title',
      'code_letters',
      'code_number',
      'code_artist_number',
      'label',
      'genre_name',
      'format_name',
      'on_streaming',
      'plays',
      'popularity',
      'artwork_url',
      'rotation_bin',
      'rotation_kill_date',
      'has_digital_audio',
    ];

    it('defines CatalogExportRow with exactly the 20 shipped fields', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      expect(schema).toBeDefined();
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual([...EXPORT_FIELDS].sort());
    });

    it('marks the 8 non-null fields required (deliberate leniency: the nullable keys are omitted)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      expect((schema.required ?? []).sort()).toEqual(
        [
          'id',
          'artist_name',
          'album_title',
          'code_letters',
          'code_number',
          'code_artist_number',
          'genre_name',
          'format_name',
        ].sort()
      );
    });

    it('keeps ALL FOUR BS#1965 producer fields out of required — a required key the server does not emit yet breaks every NDJSON line', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;

      // This row is also the iOS Spotlight clone's shape, and wxyc-ios-64
      // regenerates from this SSOT on its own cadence. Until BS#1965 ships, the
      // server emits the 15-field body; a required key absent from it fails the
      // WHOLE decode, not one field. Same leniency `popularity` shipped with.
      // oasdiff does NOT flag adding a required response property, so
      // `check:breaking` cannot catch a regression here — this test is the guard.
      for (const key of [
        'legacy_release_id',
        'album_artist',
        'alternate_artist_name',
        'cross_reference_names',
      ]) {
        const prop = schema.properties?.[key];
        expect(prop, key).toBeDefined();
        expect(prop!.nullable, key).toBe(true);
        expect(schema.required ?? [], key).not.toContain(key);
      }

      // legacy_release_id is an integer (the producer emits it AS library.db's
      // library.id); the two curated free-text fields are plain strings.
      expect(schema.properties?.legacy_release_id?.type).toBe('integer');
      expect(schema.properties?.album_artist?.type).toBe('string');
      expect(schema.properties?.alternate_artist_name?.type).toBe('string');
    });

    it('keeps has_digital_audio optional and boolean — absent means false (#417)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      const prop = schema.properties?.has_digital_audio;
      expect(prop).toBeDefined();
      expect(prop!.type).toBe('boolean');
      // A Backend not yet running WXYC/Backend-Service#2320 does not emit this
      // key at all — required would fail every NDJSON line for that Backend,
      // same reasoning as the BS#1965 producer fields above.
      expect(schema.required ?? []).not.toContain('has_digital_audio');
    });

    it('ships cross_reference_names as an ARRAY of names, never a pipe-joined string', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      const prop = schema.properties?.cross_reference_names as
        | { type?: string; items?: { type?: string } }
        | undefined;
      expect(prop).toBeDefined();

      // Nothing constrains artists.artist_name from containing "|" or " | ", and
      // LML splits this field on the pipe. A joined string would silently split
      // into phantom aliases with no escaping rule to recover from. The producer
      // does the join when it writes library.db's TEXT column.
      expect(prop!.type).toBe('array');
      expect(prop!.items?.type).toBe('string');
    });

    it('ships popularity as a nullable integer alongside plays, not as a replacement (BS#1486 Phase-2 Track 3)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      const popularity = schema.properties?.popularity;
      expect(popularity).toBeDefined();
      expect(popularity!.type).toBe('integer');
      expect(popularity!.nullable).toBe(true);
      // popularity is the corrected logical signal, NOT a rename of the
      // per-pressing linked `plays`: BOTH ship as distinct nullable-int fields,
      // and popularity stays out of `required` so a decoder predating it keeps
      // working.
      const plays = schema.properties?.plays;
      expect(plays).toBeDefined();
      expect(plays!.type).toBe('integer');
      expect(plays!.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('popularity');
    });

    it('types rotation_bin as a raw nullable string, NOT the RotationBin enum (admits N; decision 1)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      const rotationBin = schema.properties?.rotation_bin;
      expect(rotationBin).toBeDefined();
      expect(rotationBin!.type).toBe('string');
      expect(rotationBin!.nullable).toBe(true);
      // Either a $ref to RotationBin ([H,M,L,S]) OR an inline enum would make a
      // strict decoder reject 'N' — both forms must stay off rotation_bin.
      expect(rotationBin!.$ref).toBeUndefined();
      expect(rotationBin!.enum).toBeUndefined();
    });

    it('ships rotation_kill_date as a nullable date, and keeps it off AlbumSearchResult (decision 2)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      const killDate = schema.properties?.rotation_kill_date;
      expect(killDate).toBeDefined();
      expect(killDate!.type).toBe('string');
      expect(killDate!.format).toBe('date');
      expect(killDate!.nullable).toBe(true);

      const search = spec.components.schemas.AlbumSearchResult as Schema;
      expect(search.properties?.rotation_kill_date).toBeUndefined();
    });

    it('keeps CatalogExportRow a distinct flat schema, not a superset of AlbumSearchResult (decision 3)', () => {
      const schema = spec.components.schemas.CatalogExportRow as Schema;
      expect(schema.allOf).toBeUndefined();
      // It drops the search-only decoration AlbumSearchResult carries.
      for (const searchOnly of ['add_date', 'matched_via', 'matched_via_alias', 'album_dist', 'artist_dist']) {
        expect(schema.properties?.[searchOnly]).toBeUndefined();
      }
    });

    it('declares GET /library/catalog (BearerAuth; If-Modified-Since + ?since=; NDJSON 200 + 304)', () => {
      const path = spec.paths['/library/catalog'] as {
        get?: {
          security?: Array<Record<string, unknown[]>>;
          parameters?: Array<{ name: string; in: string }>;
          responses?: Record<
            string,
            { headers?: Record<string, unknown>; content?: Record<string, { schema?: { $ref?: string } }> }
          >;
        };
      };
      expect(path?.get).toBeDefined();
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);

      const ifModifiedSince = path.get!.parameters?.find((p) => p.name === 'If-Modified-Since');
      expect(ifModifiedSince?.in).toBe('header');
      const since = path.get!.parameters?.find((p) => p.name === 'since');
      expect(since?.in).toBe('query');

      const ok = path.get!.responses?.['200'];
      expect(ok).toBeDefined();
      // One NDJSON line is one CatalogExportRow (the framing itself isn't expressible in OpenAPI).
      expect(ok!.content?.['application/x-ndjson']?.schema?.$ref).toBe('#/components/schemas/CatalogExportRow');
      expect(ok!.headers?.['Last-Modified']).toBeDefined();
      expect(ok!.headers?.['Content-Encoding']).toBeDefined();
      expect(path.get!.responses?.['304']).toBeDefined();
    });

    it('requires BearerAuth on all five catalog GET reads — no half-fixed SSOT (decision 4)', () => {
      const reads = [
        '/library',
        '/library/query',
        '/library/rotation',
        '/library/catalog',
        '/library/catalog/compilation-tracks',
      ];
      for (const route of reads) {
        const path = spec.paths[route] as { get?: { security?: unknown[] } };
        expect(path?.get, route).toBeDefined();
        expect(path!.get!.security, route).toEqual([{ BearerAuth: [] }]);
      }
    });

    // --- BS#1965: sibling CTA export for the library.db producer ---

    it('defines CatalogCompilationTrackRow with exactly {legacy_release_id, artist_name, track_title}', () => {
      const schema = spec.components.schemas.CatalogCompilationTrackRow as Schema;
      expect(schema).toBeDefined();
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        ['legacy_release_id', 'artist_name', 'track_title'].sort()
      );
      // Keyed on legacy_release_id + artist_name; track_title is nullable (the CTA
      // column is). Deliberately NO `id` / `track_position` — library.db's
      // 3-column CTA table carries neither, so shipping them would break parity.
      expect((schema.required ?? []).sort()).toEqual(['legacy_release_id', 'artist_name'].sort());
      expect(schema.properties?.legacy_release_id?.type).toBe('integer');
      expect(schema.properties?.artist_name?.type).toBe('string');
      expect(schema.properties?.track_title?.type).toBe('string');
      expect(schema.properties?.track_title?.nullable).toBe(true);
      expect(schema.properties?.id).toBeUndefined();
      expect(schema.properties?.track_position).toBeUndefined();
    });

    it('pins the same length bounds as CompilationTrackInput — read and write shapes over one column must agree', () => {
      const read = spec.components.schemas.CatalogCompilationTrackRow as Schema;
      const write = spec.components.schemas.CompilationTrackInput as Schema;

      // Both project compilation_track_artist.artist_name varchar(255) NOT NULL
      // and .track_title varchar(255). The write shape pinned minLength on
      // artist_name so a regression to empty-string writes can't merge green;
      // the read shape carries the same bounds so the producer can size its
      // SQLite column from the contract instead of guessing.
      expect(read.properties?.artist_name?.minLength).toBe(write.properties?.artist_name?.minLength);
      expect(read.properties?.artist_name?.maxLength).toBe(write.properties?.artist_name?.maxLength);
      expect(read.properties?.track_title?.maxLength).toBe(write.properties?.track_title?.maxLength);
      expect(read.properties?.artist_name?.maxLength).toBe(255);
    });

    it('declares GET /library/catalog/compilation-tracks (BearerAuth; If-Modified-Since + ?since=; NDJSON 200 + 304)', () => {
      const path = spec.paths['/library/catalog/compilation-tracks'] as {
        get?: {
          security?: Array<Record<string, unknown[]>>;
          parameters?: Array<{ name: string; in: string }>;
          responses?: Record<
            string,
            { headers?: Record<string, unknown>; content?: Record<string, { schema?: { $ref?: string } }> }
          >;
        };
      };
      expect(path?.get).toBeDefined();
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);

      const ifModifiedSince = path.get!.parameters?.find((p) => p.name === 'If-Modified-Since');
      expect(ifModifiedSince?.in).toBe('header');
      const since = path.get!.parameters?.find((p) => p.name === 'since');
      expect(since?.in).toBe('query');

      const ok = path.get!.responses?.['200'];
      expect(ok).toBeDefined();
      // One NDJSON line is one CatalogCompilationTrackRow (framing isn't expressible in OpenAPI).
      expect(ok!.content?.['application/x-ndjson']?.schema?.$ref).toBe(
        '#/components/schemas/CatalogCompilationTrackRow'
      );
      expect(ok!.headers?.['Last-Modified']).toBeDefined();
      expect(ok!.headers?.['Content-Encoding']).toBeDefined();
      expect(path.get!.responses?.['304']).toBeDefined();
    });
  });

  // Digital Archive playback manifest (#417). The auto-DJ archive player's
  // client contract: album-scoped, library.id-keyed, presigned-URL-bearing,
  // with no bucket/key/store name on the wire. First consumer is wxyc-dj-ios
  // (epic WXYC/wxyc-dj-ios#135); Backend-Service is WXYC/Backend-Service#2320.
  describe('Digital Archive Playback Manifest (#417)', () => {
    type Schema = {
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
    };

    it('defines DigitalArchivePlaybackManifest with the three required fields and no manifest-level provenance', () => {
      const schema = spec.components.schemas.DigitalArchivePlaybackManifest as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(
        ['library_id', 'expires_at', 'tracks'].sort()
      );
      expect(schema.properties?.library_id?.type).toBe('integer');
      // Deliberately absent here and required on the track instead: the
      // digital_asset unique key is (library_id, provenance, disc_number), so
      // a manifest merging several bound assets has no single honest value to
      // report at this level.
      expect(schema.properties?.provenance).toBeUndefined();
      expect(schema.required ?? []).not.toContain('provenance');
      expect(schema.properties?.expires_at?.type).toBe('string');
      expect(schema.properties?.expires_at?.format).toBe('date-time');
      expect(schema.properties?.tracks?.type).toBe('array');
      expect((schema.properties?.tracks?.items as { $ref?: string } | undefined)?.$ref).toBe(
        '#/components/schemas/DigitalArchivePlaybackTrack'
      );
    });

    it('defines DigitalArchivePlaybackTrack with file_id/provenance/title/renditions required and the rest nullable', () => {
      const schema = spec.components.schemas.DigitalArchivePlaybackTrack as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(
        ['file_id', 'provenance', 'title', 'renditions'].sort()
      );
      expect(schema.properties?.file_id?.type).toBe('integer');
      expect(schema.properties?.title?.type).toBe('string');
      // Non-nullable: digital_asset.provenance is NOT NULL, so every track a
      // manifest can carry has one.
      expect(schema.properties?.provenance?.type).toBe('string');
      expect(schema.properties?.provenance?.enum).toEqual(['rotation_upload', 'cd_rip']);
      expect(schema.properties?.provenance?.nullable).toBeUndefined();

      // Partial albums and tag gaps exist; disc/track numbering is nullable
      // and the list is ordered server-side regardless.
      for (const key of ['disc_number', 'track_number']) {
        expect(schema.properties?.[key]?.type, key).toBe('integer');
        expect(schema.properties?.[key]?.nullable, key).toBe(true);
        expect(schema.required ?? [], key).not.toContain(key);
      }
      expect(schema.properties?.duration_secs?.type).toBe('number');
      expect(schema.properties?.duration_secs?.nullable).toBe(true);
      expect(schema.properties?.content_hash?.type).toBe('string');
      expect(schema.properties?.content_hash?.nullable).toBe(true);
    });

    it('defines the renditions item with codec enum [mp3, aac, flac, m4a, wav] and a required presigned url', () => {
      const track = spec.components.schemas.DigitalArchivePlaybackTrack as Schema;
      const renditions = track.properties?.renditions as { items?: Schema } | undefined;
      const item = renditions?.items;
      expect(item).toBeDefined();
      expect((item!.required ?? []).sort()).toEqual(['codec', 'url'].sort());
      // The five formats digital_asset_file.codec can hold. m4a and wav are
      // load-bearing rather than speculative: library/freeform/ carries 177
      // and 28 of them, the bind job does not skip them, and an enum without
      // them would make a bound row unrepresentable in this response.
      expect(item!.properties?.codec?.enum).toEqual(['mp3', 'aac', 'flac', 'm4a', 'wav']);
      expect(item!.properties?.url?.type).toBe('string');
      expect(item!.properties?.url?.format).toBe('uri');
      expect(item!.properties?.bitrate_kbps?.type).toBe('integer');
      expect(item!.properties?.bitrate_kbps?.nullable).toBe(true);
    });

    it('declares GET /digital-archive/albums/{id}/playback (BearerAuth; integer path param; 200/403/404)', () => {
      const path = spec.paths['/digital-archive/albums/{id}/playback'] as {
        get?: {
          'x-wxyc-service'?: string;
          security?: Array<Record<string, unknown[]>>;
          parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type?: string } }>;
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };
      expect(path?.get).toBeDefined();
      expect(path.get!['x-wxyc-service']).toBe('backend-service');
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);

      const idParam = path.get!.parameters?.find((p) => p.name === 'id');
      expect(idParam?.in).toBe('path');
      expect(idParam?.required).toBe(true);
      expect(idParam?.schema?.type).toBe('integer');

      const ok = path.get!.responses?.['200'];
      expect(ok?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DigitalArchivePlaybackManifest'
      );
      // 404 is distinct from 403 on purpose: a client's "has audio" badge may
      // be stale, so "no bound asset" must be distinguishable from "not
      // permitted to listen".
      expect(path.get!.responses?.['403']).toBeDefined();
      expect(path.get!.responses?.['404']).toBeDefined();
    });
  });

  // Compilation-track (CTA) write path (BS#1964). Adds the compilation-tracks
  // sub-collection under a library release so V/A per-track artists can be
  // written after /wxycdb goes dark. Shape A: the server READS Discogs
  // (discogs-suggestions) but every WRITE carries an explicit, client-confirmed
  // list — Discogs-agnostic, additive-only (D6: existing rows untouched), and
  // thin enough to survive the future compilation_track_artist -> library_track
  // rename (BS#801). The version sentinel travels here as the most recent change.
  describe('Compilation Track Write (BS#1964)', () => {
    type Schema = {
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
    };

    it('defines CompilationTrackInput: only artist_name required; title/position nullable + capped', () => {
      const schema = spec.components.schemas.CompilationTrackInput as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(['artist_name']);
      expect(schema.properties?.artist_name?.type).toBe('string');
      expect(schema.properties?.artist_name?.maxLength).toBe(255);
      // minLength 1 is the sole guard forcing a non-empty per-track artist on
      // the wire — the constraint the POST's 400 ("a track missing artist_name")
      // leans on; pin it so a regression to empty-string writes can't merge green.
      expect(schema.properties?.artist_name?.minLength).toBe(1);
      // The durable free-text triple — no canonical artist_id / confidence /
      // method here; BS#801 adds those server-side, not on the wire.
      expect(schema.properties?.artist_id).toBeUndefined();
      const title = schema.properties?.track_title;
      expect(title?.type).toBe('string');
      expect(title?.nullable).toBe(true);
      expect(title?.maxLength).toBe(255);
      const position = schema.properties?.track_position;
      expect(position?.type).toBe('string');
      expect(position?.nullable).toBe(true);
      expect(position?.maxLength).toBe(20);
    });

    it('defines CompilationTrack: a stored row keyed by server id', () => {
      const schema = spec.components.schemas.CompilationTrack as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(['artist_name', 'id']);
      expect(schema.properties?.id?.type).toBe('integer');
      expect(schema.properties?.track_title?.nullable).toBe(true);
      expect(schema.properties?.track_position?.nullable).toBe(true);
    });

    it('defines CompilationTrackList wrapping stored rows for a release', () => {
      const schema = spec.components.schemas.CompilationTrackList as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(['library_id', 'tracks']);
      expect((schema.properties?.tracks as { items?: { $ref?: string } })?.items?.$ref).toBe(
        '#/components/schemas/CompilationTrack'
      );
    });

    it('defines CompilationTracksWriteRequest as a non-empty list of inputs', () => {
      const schema = spec.components.schemas.CompilationTracksWriteRequest as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(['tracks']);
      const tracks = schema.properties?.tracks as { minItems?: number; items?: { $ref?: string } };
      expect(tracks?.minItems).toBe(1);
      expect(tracks?.items?.$ref).toBe('#/components/schemas/CompilationTrackInput');
    });

    it('defines CompilationTracksWriteResponse reporting inserted vs skipped (idempotent write)', () => {
      const schema = spec.components.schemas.CompilationTracksWriteResponse as Schema;
      expect(schema).toBeDefined();
      expect((schema.required ?? []).sort()).toEqual(['inserted', 'library_id', 'skipped', 'tracks']);
      expect(schema.properties?.inserted?.type).toBe('integer');
      expect(schema.properties?.skipped?.type).toBe('integer');
    });

    it('defines CompilationTrackSuggestions with a nullable discogs_release_id (no-match => manual fallback)', () => {
      const schema = spec.components.schemas.CompilationTrackSuggestions as Schema;
      expect(schema).toBeDefined();
      // discogs_release_id is REQUIRED-but-nullable so the null carries meaning
      // (looked, none resolved) rather than being an absent/unknown field.
      expect((schema.required ?? []).sort()).toEqual(['discogs_release_id', 'library_id', 'tracks']);
      expect(schema.properties?.discogs_release_id?.type).toBe('integer');
      expect(schema.properties?.discogs_release_id?.nullable).toBe(true);
      // Suggestions are write-ready inputs, not stored rows.
      expect((schema.properties?.tracks as { items?: { $ref?: string } })?.items?.$ref).toBe(
        '#/components/schemas/CompilationTrackInput'
      );
    });

    it('declares GET + POST /library/{id}/compilation-tracks (BearerAuth; list / additive write)', () => {
      const path = spec.paths['/library/{id}/compilation-tracks'] as {
        get?: { security?: unknown[]; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> };
        post?: {
          security?: unknown[];
          requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };
      expect(path?.get).toBeDefined();
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);
      expect(path.get!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompilationTrackList'
      );
      expect(path.get!.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
      expect(path?.post).toBeDefined();
      expect(path.post!.security).toEqual([{ BearerAuth: [] }]);
      expect(path.post!.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompilationTracksWriteRequest'
      );
      expect(path.post!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompilationTracksWriteResponse'
      );
      // Error contract is load-bearing (dj-site distinguishes a bad list from a
      // missing release); pin both refs so a dropped/mis-pointed response fails CI.
      expect(path.post!.responses?.['400']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
      expect(path.post!.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
    });

    it('declares GET /library/{id}/compilation-tracks/discogs-suggestions (BearerAuth; suggestions)', () => {
      const path = spec.paths['/library/{id}/compilation-tracks/discogs-suggestions'] as {
        get?: { security?: unknown[]; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> };
      };
      expect(path?.get).toBeDefined();
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);
      expect(path.get!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompilationTrackSuggestions'
      );
      expect(path.get!.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
    });

  });

  describe('Rotation Schemas', () => {
    it('should define RotationEntry', () => {
      expect(spec.components.schemas.RotationEntry).toBeDefined();
    });

    it('should define AddRotationRequest', () => {
      expect(spec.components.schemas.AddRotationRequest).toBeDefined();
    });

    it('should define RotationWithAlbum', () => {
      expect(spec.components.schemas.RotationWithAlbum).toBeDefined();
    });
  });

  // `rotation.album_id` carries no NOT NULL, and its table docblock lists
  // "NULL `album_id` (rotation entries that pre-date or didn't link to a
  // library row)" among the shapes Backend-canonical writes must accept.
  // `RotationEntry` is the echo both `POST /library/rotation` and `PATCH
  // /library/rotation` return, and both return the raw `rotation` row — so a
  // kill against the Awaiting Cataloging queue, whose rows are `album_id IS
  // NULL` by construction, echoes that null through a declaration that said
  // the field was a required non-nullable integer (#298).
  describe('RotationEntry.album_id admits the uncatalogued row (#298)', () => {
    it('declares album_id nullable, and still required', () => {
      const albumId = propertyOf('RotationEntry', 'album_id');
      expect(albumId?.type).toBe('integer');
      expect(albumId?.nullable).toBe(true);
      // Nullable value, still-present key. Both writers return the raw row,
      // which always carries the column; dropping it from `required` would
      // make the key omissible, which neither writer does.
      expect(requiredKeysOf('RotationEntry')).toContain('album_id');
    });

    // The document contradicted itself before this: `RotationRowSummary`
    // already declared the same column nullable and said why ("null while
    // uncatalogued"), so the two read shapes described one column two ways
    // and a consumer could pick either.
    it('agrees with RotationRowSummary on the shape of that column', () => {
      const entry = propertyOf('RotationEntry', 'album_id');
      const summary = propertyOf('RotationRowSummary', 'album_id');
      expect({ type: entry?.type, nullable: entry?.nullable }).toEqual({
        type: summary?.type,
        nullable: summary?.nullable,
      });
    });

    // Asserted on the composer as well as the base: a schema that stopped
    // reaching `RotationEntry` would keep the old shape while the assertion
    // above stayed green. Counted rather than merely identity-checked,
    // because a local override in a later `allOf` branch is what `propertyOf`
    // cannot see — exactly one declaration must exist, and it must be the
    // base's own object.
    it('RotationWithAlbum inherits album_id and declares no copy of its own', () => {
      const declarations = declarationsOf('RotationWithAlbum', 'album_id');
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toBe(propertyOf('RotationEntry', 'album_id'));
    });

    // Deliberately not widened. Both are request bodies naming the album a
    // caller is linking or adding, where the whole point of the field is that
    // it resolves; `LinkRotationRequest.album_id` even carries `minimum: 1`.
    // A null there would be a request to link a row to nothing.
    it.each(['AddRotationRequest', 'LinkRotationRequest'])(
      '%s keeps album_id required and non-nullable, being a request body',
      (schemaName) => {
        const albumId = propertyOf(schemaName, 'album_id');
        expect(albumId?.type).toBe('integer');
        expect(albumId?.nullable).toBeUndefined();
        expect(requiredKeysOf(schemaName)).toContain('album_id');
      }
    );
  });

  // #191: AlbumSearchResult.rotation_bin admits null. `library_artist_view`
  // LEFT JOINs `rotation` — on album_id, filtered by kill_date, never by bin
  // value — so the field is genuine SQL NULL for any release not currently
  // rotating, which is most of the catalog. `library-search.service.ts` has
  // typed this row's rotation_bin as `string | null` since the endpoint
  // shipped (2026-05-13); the non-nullable `$ref RotationBin` this replaces
  // misdescribed that wire shape, independent of any raw value ever observed.
  //
  // This is NOT an enum-widening, which is what #191 originally asked for on
  // five read sites. That premise died. It rested on a fifth live value:
  // Backend-Service migration 0041 added 'N' to `freq_enum` for "tubafrenzy's
  // New rotation type" — a category error, since tubafrenzy's "New" is a
  // flowsheet entry-type code for "not yet in rotation", the opposite of a
  // rotation weight. Migration 0150 reclassified the 15 rows carrying it and
  // dropped the member on 2026-08-17. `RotationBin [H,M,L,S]` is therefore
  // byte-identical to the Postgres type today; `freqEnum` is derived from
  // `ROTATION_BINS` so the two cannot drift apart again unnoticed; and the
  // writers gate on `parseRotationBin` ahead of an insert the enum type would
  // reject anyway. RotationEntry and RotationRowSummary echo
  // `rotation.rotation_bin` straight out of that NOT NULL column with no LEFT
  // JOIN, so they have no defect to fix — and widening them would trade live
  // exhaustive-switch safety in Swift, Kotlin and TypeScript for insurance
  // against a bug already fixed at its root. They keep the plain,
  // non-nullable `$ref RotationBin` they always had.
  describe('AlbumSearchResult.rotation_bin admits null via nullable RotationBin, not an enum-widening (#191)', () => {
    type SchemaProp = {
      nullable?: boolean;
      $ref?: string;
      allOf?: Array<{ $ref?: string }>;
    };

    // The single-branch `allOf` is not decoration: OpenAPI 3.0 IGNORES any
    // sibling key next to a bare `$ref`, so `{$ref: RotationBin, nullable:
    // true}` silently drops the nullability and generates the same type it
    // did before. Asserting the wrapper — not just the flag — is what keeps a
    // well-meaning simplification back to a bare `$ref` from passing.
    it('wraps RotationBin in allOf + nullable — the idiom AlbumSearchResult.card already uses for its own absent-row nullability', () => {
      const prop = propertyOf('AlbumSearchResult', 'rotation_bin') as SchemaProp | undefined;
      expect(prop?.allOf?.[0]?.$ref).toBe('#/components/schemas/RotationBin');
      expect(prop?.nullable).toBe(true);
    });

    // `nullable` and `required` are orthogonal here and the contract needs both
    // read together: the key is absent from `required`, so the generated type is
    // `RotationBin | null | undefined` and a consumer must handle absent as well
    // as null. Pinned because `nullable: true` reads, wrongly, as if it had also
    // made the key mandatory.
    it('leaves rotation_bin out of required — the wire may omit the key as well as null it', () => {
      expect(requiredKeysOf('AlbumSearchResult')).not.toContain('rotation_bin');
    });

    // The write surface is untouched: a DJ still assigns exactly one of the
    // four real cohorts, and RotationCreateFields is the only schema an
    // invalid assignment can be rejected from before it reaches Postgres.
    it('RotationCreateFields keeps rotation_bin strict — the write surface still asserts one of the four assignable cohorts', () => {
      const prop = propertyOf('RotationCreateFields', 'rotation_bin') as SchemaProp | undefined;
      expect(prop?.$ref).toBe('#/components/schemas/RotationBin');
      expect(prop?.allOf).toBeUndefined();
      expect(requiredKeysOf('RotationCreateFields')).toContain('rotation_bin');
    });

    // RotationEntry and RotationRowSummary echo `rotation.rotation_bin`
    // directly (no LEFT JOIN, NOT NULL column, validated at write time) —
    // genuinely enum-safe, unlike AlbumSearchResult above. They stay on the
    // plain, non-nullable enum: no change, and a guard against a future pass
    // over this same ticket re-litigating and widening them anyway.
    it.each(['RotationEntry', 'RotationRowSummary'] as const)(
      '%s.rotation_bin stays the plain, non-nullable RotationBin enum — no live defect to fix here',
      (schemaName) => {
        const prop = propertyOf(schemaName, 'rotation_bin') as SchemaProp | undefined;
        expect(prop?.$ref).toBe('#/components/schemas/RotationBin');
        expect(prop?.allOf).toBeUndefined();
        expect(prop?.nullable).toBeUndefined();
        expect(requiredKeysOf(schemaName)).toContain('rotation_bin');
      }
    );
  });

  describe('Rotation cards, per-entry URLs, status param (#453)', () => {
    type SchemaProp = {
      type?: string;
      format?: string;
      nullable?: boolean;
      items?: Record<string, unknown>;
      $ref?: string;
      allOf?: Array<{ $ref?: string }>;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
      allOf?: unknown[];
    };

    it('defines RotationCard with id, bin, number, and a nullable name', () => {
      const schema = spec.components.schemas.RotationCard as Schema;
      expect(schema).toBeDefined();
      expect(schema.properties?.id?.type).toBe('integer');
      expect(schema.properties?.bin?.$ref).toBe('#/components/schemas/RotationBin');
      expect(schema.properties?.number?.type).toBe('integer');
      expect(schema.properties?.name?.type).toBe('string');
      expect(schema.properties?.name?.nullable).toBe(true);
      expect(schema.required ?? []).toEqual(expect.arrayContaining(['id', 'bin', 'number']));
    });

    for (const schemaName of ['AddRotationRequest', 'FilingRotationRequest'] as const) {
      it(`${schemaName} gains optional urls as an array of plain strings`, () => {
        const prop = propertyOf(schemaName, 'urls');
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('array');
        expect((prop?.items as Record<string, unknown>)?.type).toBe('string');
        expect((prop?.items as Record<string, unknown>)?.format).toBeUndefined();
        expect(requiredKeysOf(schemaName)).not.toContain('urls');
      });
    }

    for (const schemaName of ['Rotation', 'RotationEntry'] as const) {
      it(`${schemaName} gains optional urls as an unbounded inline array of plain strings`, () => {
        const prop = propertyOf(schemaName, 'urls');
        expect(prop?.type).toBe('array');
        expect((prop?.items as Record<string, unknown>)?.type).toBe('string');
        expect(prop?.maxItems).toBeUndefined();
        expect(requiredKeysOf(schemaName)).not.toContain('urls');
      });
    }

    it('Rotation.urls and RotationEntry.urls are the identical inline declaration — one source of truth, pinned here', () => {
      // Deliberately inline twins rather than one named array schema:
      // naming a top-level array makes the Python generator wrap the field
      // in a RootModel (`.root` to reach the list), diverging from the
      // plain string list every other target reads. This equality is the
      // single source of truth the inline form would otherwise lack.
      expect(propertyOf('Rotation', 'urls')).toEqual(propertyOf('RotationEntry', 'urls'));
    });

    // Request-side bounds must ship with the field: oasdiff treats a later
    // maxItems/maxLength on a request property as a breaking change, so once
    // this contract merges unbounded it can never be bounded cleanly.
    for (const schemaName of ['AddRotationRequest', 'FilingRotationRequest'] as const) {
      it(`bounds ${schemaName}.urls at filing time (maxItems + per-item maxLength)`, () => {
        const prop = propertyOf(schemaName, 'urls');
        expect(prop?.maxItems).toBe(20);
        expect((prop?.items as Record<string, unknown>)?.maxLength).toBe(2048);
      });
    }

    it('AddRotationRequest and FilingRotationRequest resolve urls to the identical bounds — one schema, not two hand-copies', () => {
      // Both derive from RotationCreateFields now, so this can only fail if
      // a future edit reintroduces a second, drifting copy of the bounds.
      expect(propertyOf('AddRotationRequest', 'urls')).toEqual(
        propertyOf('FilingRotationRequest', 'urls')
      );
    });

    it('AddRotationRequest gains optional card_id as an integer', () => {
      const prop = propertyOf('AddRotationRequest', 'card_id');
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('integer');
      expect(requiredKeysOf('AddRotationRequest')).not.toContain('card_id');
    });

    it('extracts RotationCreateFields with rotation_bin required, card_id and urls optional', () => {
      const schema = spec.components.schemas.RotationCreateFields as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema).toBeDefined();
      expect(schema.properties?.rotation_bin).toBeDefined();
      expect(schema.properties?.card_id).toBeDefined();
      expect(schema.properties?.urls).toBeDefined();
      expect(schema.properties?.album_id).toBeUndefined();
      expect(schema.required).toEqual(['rotation_bin']);
    });

    it('recomposes AddRotationRequest via allOf[RotationCreateFields, album_id] with an unchanged effective shape', () => {
      const schema = spec.components.schemas.AddRotationRequest as { allOf?: Array<{ $ref?: string }> };
      expect(schema.allOf?.[0]?.$ref).toBe('#/components/schemas/RotationCreateFields');
      // Closed-set equality over the FLATTENED composition, not a subset
      // check or an index into one branch: a property or requirement added
      // to ANY allOf branch — including a future third branch — must fail
      // here, or the "effective shape unchanged" claim is unguarded.
      expect(propertyKeysOf('AddRotationRequest').sort()).toEqual(
        ['album_id', 'card_id', 'rotation_bin', 'urls'].sort()
      );
      expect(requiredKeysOf('AddRotationRequest').sort()).toEqual(
        ['album_id', 'rotation_bin'].sort()
      );
    });

    it('FilingRotationRequest resolves to RotationCreateFields\' shape with no album_id', () => {
      const schema = spec.components.schemas.FilingRotationRequest as { allOf?: Array<{ $ref?: string }> };
      expect(schema.allOf?.[0]?.$ref).toBe('#/components/schemas/RotationCreateFields');
      // Same closed-set rigor as AddRotationRequest above.
      expect(propertyKeysOf('FilingRotationRequest').sort()).toEqual(
        ['card_id', 'rotation_bin', 'urls'].sort()
      );
      expect(requiredKeysOf('FilingRotationRequest')).toEqual(['rotation_bin']);
    });

    for (const schemaName of ['Rotation', 'RotationEntry', 'AlbumSearchResult'] as const) {
      it(`${schemaName} gains optional nullable card as a $ref to RotationCard`, () => {
        const prop = propertyOf(schemaName, 'card') as SchemaProp | undefined;
        expect(prop).toBeDefined();
        expect(prop?.allOf?.[0]?.$ref).toBe('#/components/schemas/RotationCard');
        expect(prop?.nullable).toBe(true);
        expect(requiredKeysOf(schemaName)).not.toContain('card');
      });
    }

    it('GET /library/rotation gains a status query param defaulting to active', () => {
      const get = (
        spec.paths['/library/rotation'] as Record<string, Record<string, unknown>>
      ).get as { parameters?: Array<Record<string, unknown>> };
      const status = get.parameters?.find((p) => p.name === 'status');
      expect(status).toBeDefined();
      const schema = status?.schema as { enum?: string[]; default?: string };
      expect(schema.enum).toEqual(['active', 'killed', 'all']);
      expect(schema.default).toBe('active');
    });

    it('documents that status facets are not a partition', () => {
      const get = (
        spec.paths['/library/rotation'] as Record<string, Record<string, unknown>>
      ).get as { parameters?: Array<Record<string, unknown>> };
      const status = get.parameters?.find((p) => p.name === 'status') as { description?: string };
      expect(status.description).toMatch(/not a partition/i);
    });

    it('defines GET /library/rotation/cards returning RotationCard rows with active_count', () => {
      const get = (
        spec.paths['/library/rotation/cards'] as Record<string, Record<string, unknown>>
      ).get as {
        responses: { '200': { content: { 'application/json': { schema: Record<string, unknown> } } } };
      };
      const itemSchema = (get.responses['200'].content['application/json'].schema.items ??
        {}) as { allOf?: Array<Record<string, unknown>> };
      const refs = (itemSchema.allOf ?? []).map((b) => b.$ref).filter(Boolean);
      expect(refs).toContain('#/components/schemas/RotationCard');
      const countBranch = (itemSchema.allOf ?? []).find(
        (b) => (b.properties as Record<string, unknown> | undefined)?.active_count
      ) as { properties?: Record<string, SchemaProp> } | undefined;
      expect(countBranch?.properties?.active_count?.type).toBe('integer');
    });

    it('defines POST /library/rotation/cards accepting bin + optional name, returning RotationCard', () => {
      const post = (
        spec.paths['/library/rotation/cards'] as Record<string, Record<string, unknown>>
      ).post as {
        requestBody: { content: { 'application/json': { schema: { $ref?: string } } } };
        responses: { '200': { content: { 'application/json': { schema: { $ref?: string } } } } };
      };
      const reqRef = post.requestBody.content['application/json'].schema.$ref;
      const reqSchema = spec.components.schemas[reqRef!.split('/').pop() as string] as Schema;
      expect(reqSchema.properties?.bin?.$ref).toBe('#/components/schemas/RotationBin');
      expect(reqSchema.required ?? []).toContain('bin');
      expect(reqSchema.required ?? []).not.toContain('name');
      expect(post.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/RotationCard'
      );
    });

    it('defines PATCH /library/rotation/cards/{id} accepting a name, returning RotationCard', () => {
      const patch = (
        spec.paths['/library/rotation/cards/{id}'] as Record<string, Record<string, unknown>>
      ).patch as {
        requestBody: { content: { 'application/json': { schema: { $ref?: string } } } };
        responses: { '200': { content: { 'application/json': { schema: { $ref?: string } } } } };
      };
      const reqRef = patch.requestBody.content['application/json'].schema.$ref;
      const reqSchema = spec.components.schemas[reqRef!.split('/').pop() as string] as Schema;
      expect(reqSchema.properties?.name).toBeDefined();
      expect(patch.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/RotationCard'
      );
    });

    it('defines DELETE /library/rotation/cards/{id} documenting the conjunctive 409 invariant, discriminated by reason', () => {
      const del = (
        spec.paths['/library/rotation/cards/{id}'] as Record<string, Record<string, unknown>>
      ).delete as {
        responses: Record<string, { description?: string; content?: { 'application/json': { schema?: { $ref?: string } } } }>;
      };
      expect(del.responses['409']).toBeDefined();
      // Both conditions, stated once: highest-numbered card in its bin AND
      // zero active rotation rows. An earlier draft said "last card in its
      // bin" in one sentence and "last remaining card" in the next — two
      // incompatible servers could each claim conformance.
      expect(del.responses['409']?.description).toMatch(/highest-numbered/);
      expect(del.responses['409']?.description).toMatch(/zero active rotation rows/);
      expect(del.responses['409']?.description).not.toMatch(/last remaining/);
      expect(del.responses['409']?.description).toMatch(/card_not_highest_in_bin/);
      expect(del.responses['409']?.description).toMatch(/card_has_active_rotations/);
      expect(del.responses['409']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/RotationConflictError'
      );
    });

    it('defines POST /library/rotation raising a typed 409 on the card-bin mismatch', () => {
      const post = (
        spec.paths['/library/rotation'] as Record<string, Record<string, unknown>>
      ).post as {
        responses: Record<string, { description?: string; content?: { 'application/json': { schema?: { $ref?: string } } } }>;
      };
      expect(post.responses['409']).toBeDefined();
      expect(post.responses['409']?.description).toMatch(/rotation_card_bin_mismatch/);
      expect(post.responses['409']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/RotationConflictError'
      );
    });

    it('declares RotationConflictReason and RotationConflictError, sharing rotation_card_bin_mismatch with the filings 409', () => {
      const reason = spec.components.schemas.RotationConflictReason as { enum?: string[] };
      expect(reason.enum).toEqual([
        'rotation_card_bin_mismatch',
        'card_not_highest_in_bin',
        'card_has_active_rotations',
      ]);
      // One source of truth for the string, pinned by equality rather than
      // composed — OpenAPI enums do not merge cleanly across two
      // purpose-built discriminators (LibraryFilingConflictReason and this
      // one), so a spec test is what keeps them from silently forking.
      const filingReason = spec.components.schemas.LibraryFilingConflictReason as { enum?: string[] };
      expect(filingReason.enum).toContain('rotation_card_bin_mismatch');
      expect(reason.enum).toContain('rotation_card_bin_mismatch');

      const error = spec.components.schemas.RotationConflictError as {
        required?: string[];
        properties?: { message?: { type?: string }; reason?: { $ref?: string } };
      };
      expect(error.required).toEqual(['message', 'reason']);
      expect(error.properties?.message?.type).toBe('string');
      expect(error.properties?.reason?.$ref).toBe('#/components/schemas/RotationConflictReason');
    });

    it("pins what RotationCard.number means: contiguity, the create rule, and 'newest'", () => {
      const description = propertyOf('RotationCard', 'number')?.description as string;
      expect(description).toMatch(/[Cc]ontiguous 1\.\.N/);
      expect(description).toMatch(/max\(number\)\s*\+\s*1/);
      expect(description).toMatch(/highest-numbered/);
      expect(description).toMatch(/zero active rotation rows/);
      expect(description).toMatch(/no renumber endpoint/i);
      expect(description).toMatch(/highest `number`.*id.*descending/);
    });

    it('documents registration order on GET /library/rotation/cards, mirrored from /library/rotation/{id}', () => {
      const cardsGet = (
        spec.paths['/library/rotation/cards'] as Record<string, Record<string, unknown>>
      ).get as { description?: string };
      // The literal path is ambiguous with the templated GET
      // /library/rotation/{id}; the note is what tells an emitter the
      // literal must register first, and names the Backend test pinning it.
      expect(cardsGet.description).toMatch(/[Rr]egistration order is load-bearing/);
      expect(cardsGet.description).toMatch(/library-rotation-route-order\.route\.test\.ts/);
      const idGet = (
        spec.paths['/library/rotation/{id}'] as Record<string, Record<string, unknown>>
      ).get as { description?: string };
      expect(idGet.description).toMatch(/\/library\/rotation\/cards/);
    });
  });

  // `Rotation` (GET /library/rotation) is a JOIN across rotation, library,
  // artists, format, genres and rotation_cards, distinct from `RotationEntry`
  // (the raw rotation-row echo from POST/PATCH). Its contract had drifted
  // from that JOIN's actual SELECT list in library.service.ts's
  // `getRotationFromDB`: two published fields carried the wrong wire name,
  // and four wire fields were undeclared entirely (#228).
  describe('Rotation reconciled with the GET /library/rotation wire shape (#228)', () => {
    it('renames play_freq to rotation_bin — the wire name the endpoint has always emitted', () => {
      expect(propertyOf('Rotation', 'play_freq')).toBeUndefined();
      const prop = propertyOf('Rotation', 'rotation_bin');
      expect(prop).toBeDefined();
      expect(prop?.$ref).toBe('#/components/schemas/RotationBin');
    });

    // A pure rename, not a retype: play_freq was already `$ref: RotationBin`,
    // so rotation_bin keeps that exact type. Kept as the ENUM rather than
    // widened to a raw string, because the premise for widening has since
    // been retracted: 'N' was dropped from freq_enum by migration 0150, so
    // RotationBin's [H,M,L,S] now admits exactly the values the live Postgres
    // domain does (the two differ only in declaration order, which nothing
    // reads), and enum -> string would trade Swift and Kotlin exhaustive
    // switches for resilience against a value that can no longer occur.
    // The non-nullability argument is spelled out in api.yaml's own comment
    // above this property.
    it('types rotation_bin as a plain, non-nullable $ref to RotationBin', () => {
      const prop = propertyOf('Rotation', 'rotation_bin');
      expect(prop?.$ref).toBe('#/components/schemas/RotationBin');
      expect(prop?.type).toBeUndefined();
      expect(prop?.nullable).toBeUndefined();
      expect(prop?.allOf).toBeUndefined();
    });

    it('renames kill_date to rotation_kill_date, keeping its nullable date shape', () => {
      expect(propertyOf('Rotation', 'kill_date')).toBeUndefined();
      const prop = propertyOf('Rotation', 'rotation_kill_date');
      expect(prop?.type).toBe('string');
      expect(prop?.format).toBe('date');
      expect(prop?.nullable).toBe(true);
    });

    // COALESCE(artists.alphabetical_name, rotation.artist_name): nullable
    // because the fallback (`rotation.artist_name`) carries no NOT NULL —
    // an uncatalogued row added with no artist snapshot at all reaches it.
    it('adds alphabetical_name as a nullable string', () => {
      const prop = propertyOf('Rotation', 'alphabetical_name');
      expect(prop?.type).toBe('string');
      expect(prop?.nullable).toBe(true);
    });

    // library.label_id: nullable both because the column itself carries no
    // NOT NULL (a catalogued release can have no resolved label) and because
    // an uncatalogued rotation row has no library row to join at all.
    it('adds label_id as a nullable integer', () => {
      const prop = propertyOf('Rotation', 'label_id');
      expect(prop?.type).toBe('integer');
      expect(prop?.nullable).toBe(true);
    });

    // rotation.add_date, distinct from add_date (library.add_date, the
    // catalog release's own add date). Always present and never nullable:
    // rotation is the driving table, so every returned row carries its own
    // add_date regardless of whether it ever linked to a library row. The
    // `date` here is checked against the column: `rotation.add_date` really is
    // a Postgres `date`, so the wire carries a bare YYYY-MM-DD.
    it('adds rotation_add_date as a non-nullable date', () => {
      const prop = propertyOf('Rotation', 'rotation_add_date');
      expect(prop?.type).toBe('string');
      expect(prop?.format).toBe('date');
      expect(prop?.nullable).toBeUndefined();
    });

    // The sibling `add_date` survives as its own property — the whole point of
    // introducing `rotation_add_date` under a separate name is that the two
    // name different columns. Bare existence-and-distinctness check; the
    // shape assertion for `add_date` itself is the dedicated test below.
    it('leaves the sibling add_date in place as a distinct property', () => {
      const addDate = propertyOf('Rotation', 'add_date');
      expect(addDate).toBeDefined();
      expect(addDate).not.toBe(propertyOf('Rotation', 'rotation_add_date'));
    });

    // `library.add_date` is a `timestamptz`, and `getRotationFromDB` reads it
    // via a raw `db.execute` — drizzle's postgres-js driver installs a
    // transparent (pass-through) parser for timestamp/date OIDs on that path
    // (node_modules/drizzle-orm/postgres-js/driver.cjs), so the wire carries
    // Postgres' own text rendering, not a parsed/reformatted value. Verified
    // locally against a bare Postgres instance with the session in UTC:
    // `'2026-08-20'::date::timestamptz` renders as `2026-08-20 00:00:00+00`
    // — a space separator and a colon-less offset, satisfying neither RFC
    // 3339 date-time (`T` separator, `+00:00`-style offset) nor an RFC 3339
    // full-date (10 bytes). Declaring either format here would be a claim
    // the wire cannot back, so this declares none — see
    // WXYC/Backend-Service#2349 for the identical defect already tracked on
    // `PlaylistSearchResult.play_date`.
    it('declares add_date a nullable string with no format — the wire is raw Postgres timestamptz text, not RFC 3339', () => {
      const prop = propertyOf('Rotation', 'add_date');
      expect(prop?.type).toBe('string');
      expect(prop?.format).toBeUndefined();
      expect(prop?.nullable).toBe(true);
      expect(prop?.description).toMatch(/2349/);
    });

    it('adds reconciled_identity as a nullable reference to the shared ReconciledIdentity schema', () => {
      const prop = propertyOf('Rotation', 'reconciled_identity') as
        | { allOf?: Array<{ $ref?: string }>; nullable?: boolean }
        | undefined;
      expect(prop?.allOf?.[0]?.$ref).toBe('#/components/schemas/ReconciledIdentity');
      expect(prop?.nullable).toBe(true);
    });

    // dj-site#725 also named `album_artist` and `matched_via` as missing from
    // `Rotation`. Both are AlbumSearchResult search-only decorations that
    // `getRotationFromDB`'s SELECT list never emits — adding them here would
    // describe a field this endpoint does not serve.
    it('does not add album_artist or matched_via — AlbumSearchResult decorations this endpoint never emits', () => {
      expect(propertyOf('Rotation', 'album_artist')).toBeUndefined();
      expect(propertyOf('Rotation', 'matched_via')).toBeUndefined();
    });

    // getRotationFromDB LEFT JOINs library/artists/format/genres/
    // genre_artist_crossreference onto rotation, and ~151 of ~310 active
    // rows carry album_id IS NULL (uncatalogued — no library row to join at
    // all). Every column sourced from those tables reads as SQL NULL on
    // such a row regardless of the underlying column's own NOT NULL — the
    // same reasoning already applied to `alphabetical_name` and `label_id`
    // above. `library.service.ts`'s own `Rotation` interface types all
    // eleven `| null`, `id` included, matching what
    // `e2e/types/generated-types.test.ts` already treats as null on an
    // uncatalogued row. The contract shipped forbidding exactly that null;
    // this declares what the interface already asserts.
    it.each([
      ['id', 'integer'],
      ['code_letters', 'string'],
      ['code_artist_number', 'integer'],
      ['code_number', 'integer'],
      ['artist_name', 'string'],
      ['album_title', 'string'],
      ['record_label', 'string'],
      ['genre_name', 'string'],
      ['format_name', 'string'],
      ['plays', 'integer'],
      ['add_date', 'string'],
    ] as const)('declares %s a nullable %s, matching the LEFT JOIN', (field, type) => {
      const prop = propertyOf('Rotation', field);
      expect(prop?.type).toBe(type);
      expect(prop?.nullable).toBe(true);
    });

    // House convention: `required` names keys that are always present;
    // `nullable` names values that may be null. A field can be both. This
    // guards the convention actually applied above — the eleven fields
    // became nullable, not required-and-nullable, because `Rotation`
    // never had a `required` list to begin with.
    it('adds no required list to Rotation — every key stays optional', () => {
      expect(requiredKeysOf('Rotation')).toEqual([]);
    });
  });

  // The queue's `status` (WXYC/Backend-Service#2504) borrows the sibling's
  // vocabulary and inverts its default. api.yaml asserted the opposite --
  // "Deliberately not status-filtered" -- for as long as the parameter had
  // shipped, so these pin the reversal in both directions (#470).
  describe('status on GET /library/rotation/uncatalogued (#470 / BS#2504)', () => {
    const operation = () =>
      (spec.paths['/library/rotation/uncatalogued'] as Record<string, Record<string, unknown>>).get as {
        description?: string;
        parameters?: Array<Record<string, unknown>>;
        responses?: Record<string, { description?: string }>;
      };
    const statusParam = () =>
      operation().parameters?.find((p) => p.name === 'status') as
        | { in?: string; required?: boolean; description?: string; schema?: { enum?: string[]; default?: string } }
        | undefined;
    const siblingGet = () =>
      (spec.paths['/library/rotation'] as Record<string, Record<string, unknown>>).get as {
        parameters?: Array<Record<string, unknown>>;
        responses?: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }>;
      };

    it('declares status as an optional query param over the sibling vocabulary', () => {
      const status = statusParam();
      expect(status).toBeDefined();
      expect(status?.in).toBe('query');
      expect(status?.required).toBe(false);
      expect(status?.schema?.enum).toEqual(['active', 'killed', 'all']);
    });

    // The whole reason the parameter belongs in the published contract: an
    // `active` default would render dj-site's "Show killed releases too"
    // checkbox permanently empty, and the killed cohort is most of the backlog.
    it('defaults to all here and to active on the sibling -- the asymmetry a client author gets wrong', () => {
      const here = statusParam()?.schema?.default;
      const sibling = siblingGet().parameters?.find((p) => p.name === 'status') as
        | { schema?: { default?: string } }
        | undefined;
      expect(here).toBe('all');
      expect(sibling?.schema?.default).toBe('active');
      expect(here).not.toBe(sibling?.schema?.default);
    });

    it('states the differing default in prose, not only in the schema', () => {
      expect(statusParam()?.description).toMatch(/`all` here, `active`\s+there/);
    });

    it("carries the sibling's non-partition warning, so a future-dated kill is not a surprise", () => {
      const description = statusParam()?.description ?? '';
      expect(description).toMatch(/do not partition/i);
      expect(description).toMatch(/kill_date IS NULL OR kill_date > CURRENT_DATE/);
      expect(description).toMatch(/kill_date IS NOT NULL/);
    });

    it('retires the "Deliberately not status-filtered" claim the parameter falsified', () => {
      expect(operation().description ?? '').not.toMatch(/not status-filtered/i);
    });

    it('documents both orderings on the 200, since killed sorts on a different key', () => {
      const description = operation().responses?.['200']?.description ?? '';
      expect(description).toMatch(/kill_date DESC/);
      expect(description).toMatch(/add_date DESC/);
      // The quirk that falls out of kill-date ordering and never applied to
      // the add-date one: a kill scheduled ahead sorts above the real ones.
      expect(description).toMatch(/future-dated\s+kill sorts to the TOP/);
    });

    it('covers the third refusal on the 400, alongside limit and offset', () => {
      const description = operation().responses?.['400']?.description ?? '';
      expect(description).toMatch(/limit/);
      expect(description).toMatch(/offset/);
      expect(description).toMatch(/status/);
    });

    // Same handler guard on the sibling, which has been able to 400 on a bad
    // status since #453 declared the parameter without declaring the refusal.
    it('declares the sibling 400 the status param made reachable', () => {
      const responses = siblingGet().responses;
      expect(responses?.['400']?.description).toMatch(/status/);
      expect(responses?.['400']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
    });
  });

  // `GET /flowsheet/shows/recent` (WXYC/Backend-Service#2435) shipped with its
  // shape declared only in Backend's app.yaml, which is Swagger-UI display and
  // not a codegen source — so dj-site, iOS and Android generated nothing for an
  // endpoint whose stated consumer is a DJ-facing handoff screen (#469).
  describe('GET /flowsheet/shows/recent (#469 / BS#2435)', () => {
    const operation = () =>
      (spec.paths['/flowsheet/shows/recent'] as Record<string, Record<string, unknown>> | undefined)?.get as {
        description?: string;
        security?: unknown;
        parameters?: Array<Record<string, unknown>>;
        responses?: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }>;
      };
    const windowHours = () =>
      operation()?.parameters?.find((p) => p.name === 'window_hours') as
        | {
            in?: string;
            required?: boolean;
            schema?: { type?: string; minimum?: number; maximum?: number; default?: number };
          }
        | undefined;

    it('declares the path the SSOT was missing', () => {
      expect(spec.paths['/flowsheet/shows/recent']).toBeDefined();
      expect(operation()).toBeDefined();
    });

    it('returns RecentShowsResponse on the 200', () => {
      expect(operation()?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/RecentShowsResponse'
      );
    });

    // One week, deliberately far below the 30-year ceiling its /open-shows
    // neighbour offers — this is a handoff read, not an archive walk. Backend
    // rejects an out-of-range value rather than clamping it.
    it('bounds window_hours at one week and defaults to the last shift', () => {
      const parameter = windowHours();
      expect(parameter).toBeDefined();
      expect(parameter?.in).toBe('query');
      expect(parameter?.required).toBe(false);
      expect(parameter?.schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 168, default: 24 });
    });

    // The route is `requirePermissions({ flowsheet: ['read'] })`, so it takes
    // the document-level BearerAuth default. An operation-level `security: []`
    // here would promise a 200 to a tokenless client and deliver a 401 — the
    // #368 failure mode the PUBLIC_OPERATIONS allowlist exists to catch.
    it('does not override the document security default', () => {
      // Asserted against a operation that exists: `operation()?.security` is
      // vacuously undefined when the path is absent, which would let this pass
      // against the very spec it was written to reject.
      const op = operation();
      expect(op).toBeDefined();
      expect(Object.keys(op as object)).not.toContain('security');
    });

    it('declares the 400 the bounds make reachable, and the 403 the gate does', () => {
      expect(operation()?.responses?.['400']?.description).toMatch(/window_hours/);
      expect(operation()?.responses?.['403']?.description).toMatch(/flowsheet: read/);
    });

    it('declares RecentShow with every field the handler always emits', () => {
      const schema = spec.components.schemas.RecentShow as { required?: string[] } | undefined;
      expect(schema).toBeDefined();
      expect(schema?.required).toEqual(['id', 'show_name', 'start_time', 'end_time', 'djs']);
    });

    // The reason #469 was worth filing rather than pasting app.yaml's block in:
    // the DJ item is byte-for-byte OnAirDJ. Backend composes both endpoints'
    // lists from one function (`composeShowDJList`); a second inline copy in the
    // contract is how the two come to disagree anyway.
    it('refs OnAirDJ for djs[] rather than re-inlining the shape', () => {
      const djs = propertyOf('RecentShow', 'djs') as
        | { type?: string; items?: { $ref?: string; properties?: unknown } }
        | undefined;
      expect(djs?.type).toBe('array');
      expect(djs?.items?.$ref).toBe('#/components/schemas/OnAirDJ');
      expect(djs?.items?.properties).toBeUndefined();
    });

    it('declares RecentShowsResponse as a shows envelope over RecentShow', () => {
      const schema = spec.components.schemas.RecentShowsResponse as
        | { required?: string[]; properties?: Record<string, { items?: { $ref?: string } }> }
        | undefined;
      expect(schema).toBeDefined();
      expect(schema?.required).toEqual(['shows']);
      expect(schema?.properties?.shows?.items?.$ref).toBe('#/components/schemas/RecentShow');
    });
  });

  // What `$ref`ing OnAirDJ above forced into the open: the schema declared
  // `dj_name` non-nullable while every operation composing it resolved the
  // handle through `resolveDjDisplayName`, which yields null for a blank handle
  // and for the literal "Anonymous" (BS#1286). The declaration was wrong, not
  // the server — see oasdiff-err-ignore.txt for why the resulting
  // response-property-became-nullable ERR marks a correction, not a break.
  describe('OnAirDJ.dj_name nullability (#469)', () => {
    const onAirDj = () =>
      spec.components.schemas.OnAirDJ as { required?: string[]; properties: Record<string, Record<string, unknown>> };

    // Nullable and required are orthogonal, and both halves matter: the key is
    // always on the wire carrying null, never omitted.
    it('is a nullable string and stays required — present-but-null, not absent', () => {
      expect(onAirDj().properties.dj_name?.type).toBe('string');
      expect(onAirDj().properties.dj_name?.nullable).toBe(true);
      expect(onAirDj().required).toContain('dj_name');
    });

    it('retires the same claim where ShowPlaylist repeats it', () => {
      const description = (spec.components.schemas.ShowPlaylist as { description?: string }).description ?? '';
      expect(description).not.toMatch(/`dj_name` is non-nullable where this route's is not/);
    });
  });

  // ShowPlaylistDJ was forked from OnAirDJ on the claim that a non-null
  // dj_name "holds for the live-DJ endpoints but not here". It never did:
  // /flowsheet/playlist's show_djs, /flowsheet/djs-on-air and
  // /flowsheet/shows/recent all resolve the handle through the same
  // `resolveDjDisplayName`. Widening OnAirDJ.dj_name (#469) removed the last
  // structural difference, leaving two names for one shape and a generated
  // type per name in four languages.
  describe('ShowPlaylistDJ collapsed into OnAirDJ (#473)', () => {
    it('refs OnAirDJ for show_djs[] rather than a forked twin', () => {
      const showDjs = propertyOf('ShowPlaylist', 'show_djs') as
        | { type?: string; items?: { $ref?: string; properties?: unknown } }
        | undefined;
      expect(showDjs?.type).toBe('array');
      expect(showDjs?.items?.$ref).toBe('#/components/schemas/OnAirDJ');
      expect(showDjs?.items?.properties).toBeUndefined();
    });

    it('deletes ShowPlaylistDJ from components.schemas', () => {
      expect(spec.components.schemas.ShowPlaylistDJ).toBeUndefined();
    });

    // Whole-document, not just the two sites above: a name that survives
    // anywhere — a stale $ref, a description naming the retired twin as the
    // one to prefer — is a name the next author can reach for.
    it('leaves no mention of the retired name anywhere in the document', () => {
      expect(specText).not.toContain('ShowPlaylistDJ');
    });

    // The collapse restores the `$ref` ShowPlaylist carried before the fork, so
    // a description recounting that it "previously $ref'ed OnAirDJ" now
    // contradicts the line directly beneath it. The nullability the sentence
    // exists to disown is stated where it belongs, on OnAirDJ.dj_name.
    it('stops recounting a non-nullable dj_name it no longer has a twin to contrast', () => {
      const description = (spec.components.schemas.ShowPlaylist as { description?: string }).description ?? '';
      expect(description).not.toMatch(/non-nullable/);
    });
  });

  describe('GET /flowsheet declares the shape it serves (#485)', () => {
    const UNION_MEMBERS = [
      'FlowsheetV2TrackEntry',
      'FlowsheetV2ShowStartEntry',
      'FlowsheetV2ShowEndEntry',
      'FlowsheetV2DJJoinEntry',
      'FlowsheetV2DJLeaveEntry',
      'FlowsheetV2TalksetEntry',
      'FlowsheetV2BreakpointEntry',
      'FlowsheetV2MessageEntry',
    ];

    // Schema names `$ref`-ed anywhere in a subtree. Structural, not textual:
    // a description that names a schema is prose, and an assertion that cannot
    // tell the two apart passes on the mention while the reference it exists to
    // check is gone.
    function refsIn(node: unknown, out = new Set<string>()): Set<string> {
      if (Array.isArray(node)) {
        for (const child of node) refsIn(child, out);
        return out;
      }
      if (node === null || typeof node !== 'object') return out;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string' && value.includes('/schemas/')) {
          out.add(value.slice(value.lastIndexOf('/') + 1));
        } else {
          refsIn(value, out);
        }
      }
      return out;
    }

    function flowsheetGetResponses(): Record<string, unknown> {
      const path = spec.paths['/flowsheet'] as { get?: { responses?: Record<string, unknown> } };
      return path.get?.responses ?? {};
    }

    function flowsheetGet200(): Record<string, unknown> {
      const ok = flowsheetGetResponses()['200'] as
        | { content?: Record<string, { schema?: Record<string, unknown> }> }
        | undefined;
      return ok?.content?.['application/json']?.schema ?? {};
    }

    // The defect: the path declared `array<FlowsheetEntryResponse>` — the
    // flattened V1 row, every field optional, no discriminator — while all
    // three of the handler's branches project through `projectEntriesV2`. The
    // schema for what it actually serves existed the whole time and was
    // referenced by nothing.
    it('no longer types the response as the flattened V1 row', () => {
      expect([...refsIn(flowsheetGet200())]).not.toContain('FlowsheetEntryResponse');
    });

    // One route, two response shapes, chosen by query parameter: `shows_limit`
    // or an id range answers with a bare array, everything else with the
    // pagination envelope. Declaring only the envelope would swap one lie for
    // a narrower one, so the 200 is a oneOf over both.
    it('declares both branch shapes, the envelope and the bare array', () => {
      const branches = (flowsheetGet200().oneOf ?? []) as Array<{
        $ref?: string;
        type?: string;
        items?: { $ref?: string };
      }>;
      expect(branches).toHaveLength(2);
      expect(branches[0]?.$ref).toBe('#/components/schemas/FlowsheetV2PaginatedResponse');
      expect(branches[1]?.type).toBe('array');
      expect(branches[1]?.items?.$ref).toBe('#/components/schemas/FlowsheetV2Entry');
    });

    // The two array branches 404 on an empty result rather than answering
    // `[]`, so emptiness has two different statuses on one endpoint depending
    // on the query. Declared because a client that treats 404 as an error
    // breaks on a quiet day.
    // Both error statuses are real and were undeclared. They reuse the shared
    // `ApiErrorResponse` rather than inlining `{message}`: an inline copy emits
    // a duplicate anonymous struct in every generated language and silently
    // drops the optional `code`/`details` the error middleware can attach.
    it.each(['400', '404'])('declares %s against the shared error shape', (status) => {
      const response = flowsheetGetResponses()[status] as
        | { content?: Record<string, { schema?: { $ref?: string } }> }
        | undefined;
      expect(response).toBeDefined();
      expect(response?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
    });

    // The union was pasted into two schemas. Nothing made the copies track each
    // other, which is the whole hazard: a ninth variant added to one is simply
    // absent from the other, and no test fails. Each member name may now appear
    // exactly twice in the document — once as a `oneOf` arm and once in the
    // discriminator mapping — and both occurrences are inside FlowsheetV2Entry.
    it.each(UNION_MEMBERS)('refs %s from FlowsheetV2Entry and from nowhere else', (member) => {
      const holders = Object.entries(spec.components.schemas)
        .filter(([name, schema]) => name !== member && refsIn(schema).has(member))
        .map(([name]) => name);
      const pathHolders = Object.entries(spec.paths)
        .filter(([, item]) => refsIn(item).has(member))
        .map(([path]) => path);
      expect([...holders, ...pathHolders]).toEqual(['FlowsheetV2Entry']);
    });

    it('points every schema call site at the named union rather than inlining it', () => {
      for (const schemaName of [
        'FlowsheetV2PaginatedResponse',
        'ShowPlaylist',
        'FlowsheetRangeResponse',
      ]) {
        const entries = propertyOf(schemaName, 'entries') as
          | { type?: string; items?: { $ref?: string; oneOf?: unknown } }
          | undefined;
        expect(entries?.type, schemaName).toBe('array');
        expect(entries?.items?.$ref, schemaName).toBe('#/components/schemas/FlowsheetV2Entry');
        expect(entries?.items?.oneOf, schemaName).toBeUndefined();
      }
    });

    // Three states, not two: an object names a live DJ, JSON `null` confirms
    // automation, and an ABSENT key means the server could not resolve it and
    // the client should show nothing rather than assert automation. Absence is
    // only distinguishable from null while `on_air` stays out of `required` —
    // the iOS decoder branches on exactly that difference.
    it('keeps on_air out of required so absent stays distinct from null', () => {
      expect(propertyKeysOf('FlowsheetV2PaginatedResponse')).toContain('on_air');
      expect(requiredKeysOf('FlowsheetV2PaginatedResponse')).not.toContain('on_air');
      expect(propertyOf('FlowsheetV2PaginatedResponse', 'on_air')?.nullable).toBe(true);
    });

    // Reaching the envelope from the path is what makes `OnAirInfo` reachable
    // at all — it hangs off `on_air` and nothing else refers to it. Both were
    // exempted from the reachability guard for precisely this reason, and that
    // exemption group is now gone; this asserts the condition it stood for.
    it('leaves no schema in the V2 flowsheet response unreachable', () => {
      expect(refsIn(spec.paths['/flowsheet'])).toContain('FlowsheetV2PaginatedResponse');
      expect(refsIn(spec.components.schemas.FlowsheetV2PaginatedResponse)).toContain('OnAirInfo');
    });

    // V1 is not retired: four write operations still $ref it, and repointing
    // the read paths orphans none of them. Asserted by counting $ref sites
    // rather than by finding the name somewhere in `spec.paths` — the name
    // also appears in two path DESCRIPTIONS, which would satisfy a text search
    // no matter how many references were deleted.
    //
    // All four now serve what they declare. They are the write responses
    // (`POST` / `PATCH` / `DELETE /flowsheet`, `PATCH /flowsheet/play-order`),
    // every one of them projected by `projectFlowsheetEntry` via
    // `sendProjectedEntry`. The count was five until `GET /flowsheet/latest`
    // moved to the V2 union — it was the one site declaring this schema while
    // returning `transformToV2`.
    it('leaves FlowsheetEntryResponse referenced by the operations that declare it', () => {
      const sites = Object.values(spec.paths).flatMap((item) =>
        Object.values(item as Record<string, { responses?: unknown }>)
          .filter((op) => op && typeof op === 'object' && 'responses' in op)
          .filter((op) => refsIn(op.responses).has('FlowsheetEntryResponse'))
      );
      expect(spec.components.schemas.FlowsheetEntryResponse).toBeDefined();
      expect(sites).toHaveLength(4);
    });

    // The last of the three read sites that declared V1 while serving V2
    // (#485, #487, then this). A single entry, not an array — `getLatest`
    // projects one row — so it $refs the union directly.
    describe('GET /flowsheet/latest declares the shape it serves (#491)', () => {
      function latestGet(): Record<string, { description?: string; content?: unknown }> {
        const op = (spec.paths['/flowsheet/latest'] as { get?: { responses?: unknown } } | undefined)
          ?.get;
        if (!op) throw new Error('/flowsheet/latest is missing from api.yaml');
        return (op.responses ?? {}) as Record<string, { description?: string; content?: unknown }>;
      }

      it('returns the V2 union directly, not an array and not the V1 row', () => {
        const schema = refsIn(latestGet()['200']);
        expect(schema.has('FlowsheetV2Entry')).toBe(true);
        expect(schema.has('FlowsheetEntryResponse')).toBe(false);
        // A single entry: an array here would make every consumer index into
        // a one-element list that the handler never sends.
        const media = (latestGet()['200'] as { content?: Record<string, { schema?: { type?: string } }> })
          .content?.['application/json'];
        expect(media?.schema?.type).toBeUndefined();
      });

      // No entry_type filter in the handler — it projects whichever row is
      // newest — so a talkset or breakpoint being latest is ordinary, and the
      // track variant alone would be wrong for it.
      it('admits every variant, not just track', () => {
        expect(refsIn(latestGet()['200']).has('FlowsheetV2TrackEntry')).toBe(false);
      });

      // The handler answers 204 on an empty flowsheet. Declaring only 200 left
      // consumers to discover the empty case from a body that never arrives.
      it('declares the 204 it answers on an empty flowsheet, with no content', () => {
        const noContent = latestGet()['204'];
        expect(noContent, '204 is undeclared').toBeDefined();
        expect(noContent?.content).toBeUndefined();
        expect(String(noContent?.description)).toMatch(/empty/i);
      });
    });
  });

  describe('Library filings transactional composite (#454)', () => {
    it('extracts AlbumCreateFields with every AddAlbumRequest field except the artist ones', () => {
      const schema = spec.components.schemas.AlbumCreateFields as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema).toBeDefined();
      expect(schema.properties?.artist_name).toBeUndefined();
      expect(schema.properties?.artist_id).toBeUndefined();
      expect(schema.properties?.album_title).toBeDefined();
      expect(schema.properties?.genre_id).toBeDefined();
      expect(schema.properties?.format_id).toBeDefined();
      expect(schema.properties?.code_number).toBeDefined();
      expect(schema.required).toEqual(['album_title', 'genre_id', 'format_id']);
    });

    it('states the "at least one of label or label_id" rule on BOTH AlbumCreateFields and AddAlbumRequest', () => {
      // Swift and Kotlin flatten `allOf` into a standalone type whose doc
      // comment comes from the composing schema's own top-level description,
      // with no link back to AlbumCreateFields' text — so the rule must be
      // stated on each schema a generator can flatten, not just where the
      // fields live.
      const albumCreateFields = spec.components.schemas.AlbumCreateFields as {
        description?: string;
      };
      expect(albumCreateFields.description).toMatch(
        /At least one of `label` or `label_id` must be provided/
      );
      const addAlbumRequest = spec.components.schemas.AddAlbumRequest as { description?: string };
      expect(addAlbumRequest.description).toMatch(
        /at least one of `label` or `label_id` must be provided/i
      );
    });

    it('recomposes AddAlbumRequest via allOf[AlbumCreateFields, artist fields] with an unchanged effective shape', () => {
      const schema = spec.components.schemas.AddAlbumRequest as { allOf?: Array<{ $ref?: string }> };
      expect(schema.allOf?.[0]?.$ref).toBe('#/components/schemas/AlbumCreateFields');
      // Closed-set equality, not a subset check: an added or dropped
      // property must fail here, or the "effective shape unchanged" claim
      // is unguarded.
      const albumCreateFieldKeys = Object.keys(
        (spec.components.schemas.AlbumCreateFields as { properties: Record<string, unknown> })
          .properties
      );
      const artistBranchKeys = Object.keys(
        (
          (spec.components.schemas.AddAlbumRequest as {
            allOf: Array<{ properties?: Record<string, unknown> }>;
          }).allOf[1]?.properties ?? {}
        )
      );
      expect([...albumCreateFieldKeys, ...artistBranchKeys].sort()).toEqual(
        [
          'album_title',
          'artist_name',
          'artist_id',
          'label',
          'label_id',
          'genre_id',
          'format_id',
          'code_number',
          'code_volume_letters',
          'disc_quantity',
          'alternate_artist_name',
          'album_artist',
        ].sort()
      );
      for (const field of albumCreateFieldKeys) {
        expect(propertyOf('AddAlbumRequest', field)).toBeDefined();
      }
      expect(requiredKeysOf('AddAlbumRequest')).toEqual(['album_title', 'genre_id', 'format_id']);
    });

    it('AddArtistRequest gains optional code_number: bounded, hedged on the deployed 400, citing the real peek route', () => {
      const prop = propertyOf('AddArtistRequest', 'code_number');
      expect(prop).toBeDefined();
      expect(prop?.type).toBe('integer');
      expect(prop?.minimum).toBe(1);
      // int4 ceiling of genre_artist_crossreference.artist_genre_code —
      // request-side bounds can never be added after publish (oasdiff
      // treats that as breaking), so absence here is not fixable later.
      expect(prop?.maximum).toBe(2147483647);
      const description = prop?.description as string;
      expect(description).toMatch(/server assigns the next number/i);
      // The description must be honest about the deployed behavior (the
      // controller 400s on omission until WXYC/Backend-Service#2475) and
      // cite the real generator route. `/library/artists/search` performs
      // no code-number generation — the false citation this replaces.
      expect(description).toMatch(/WXYC\/Backend-Service#2475/);
      expect(description).toMatch(/peek-code/);
      expect(description).not.toMatch(/artists\/search/);
      expect(requiredKeysOf('AddArtistRequest')).not.toContain('code_number');
    });

    it('defines LibraryFilingRequest with a discriminated FilingArtist, release, and optional rotation', () => {
      const schema = spec.components.schemas.LibraryFilingRequest as {
        required?: string[];
        properties?: {
          artist?: { $ref?: string };
          release?: { $ref?: string };
          rotation?: { $ref?: string };
        };
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(expect.arrayContaining(['artist', 'release']));
      expect(schema.properties?.artist?.$ref).toBe('#/components/schemas/FilingArtist');
      expect(schema.properties?.release?.$ref).toBe('#/components/schemas/AlbumCreateFields');
      expect(schema.properties?.rotation?.$ref).toBe('#/components/schemas/FilingRotationRequest');
      expect(schema.required).not.toContain('rotation');
    });

    it('discriminates FilingArtist on a required kind, like LiveFsEvent and AutoDJWebSocketMessage', () => {
      // An undiscriminated oneOf here mis-resolves a both-fields payload:
      // try-order decoders (generated Swift and Python) take the create arm
      // and silently drop artist_id, filing a duplicate artist — and the
      // Kotlin generator collapses the union into one degenerate
      // intersection class. The discriminator is what separates the repo's
      // working unions from that failure mode.
      const union = spec.components.schemas.FilingArtist as {
        oneOf?: Array<{ $ref?: string }>;
        discriminator?: { propertyName?: string; mapping?: Record<string, string> };
      };
      expect(union.oneOf?.map((b) => b.$ref)).toEqual([
        '#/components/schemas/FilingArtistCreate',
        '#/components/schemas/FilingArtistExisting',
      ]);
      expect(union.discriminator?.propertyName).toBe('kind');
      expect(union.discriminator?.mapping).toEqual({
        create: '#/components/schemas/FilingArtistCreate',
        existing: '#/components/schemas/FilingArtistExisting',
      });

      const create = spec.components.schemas.FilingArtistCreate as {
        allOf?: Array<{
          $ref?: string;
          required?: string[];
          properties?: { kind?: { enum?: string[] } };
        }>;
      };
      expect(create.allOf?.[0]?.$ref).toBe('#/components/schemas/AddArtistRequest');
      expect(create.allOf?.[1]?.required).toContain('kind');
      expect(create.allOf?.[1]?.properties?.kind?.enum).toEqual(['create']);

      const existing = spec.components.schemas.FilingArtistExisting as {
        required?: string[];
        properties?: { kind?: { enum?: string[] }; artist_id?: { type?: string } };
      };
      expect(existing.required).toEqual(expect.arrayContaining(['kind', 'artist_id']));
      expect(existing.properties?.kind?.enum).toEqual(['existing']);
      expect(existing.properties?.artist_id?.type).toBe('integer');
    });

    it('defines LibraryFilingResponse as all-$ref: artist, release, and optional rotation', () => {
      const schema = spec.components.schemas.LibraryFilingResponse as {
        required?: string[];
        properties?: {
          artist?: { $ref?: string };
          release?: { $ref?: string };
          rotation?: { $ref?: string };
        };
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(expect.arrayContaining(['artist', 'release']));
      expect(schema.properties?.artist?.$ref).toBe('#/components/schemas/Artist');
      expect(schema.properties?.release?.$ref).toBe('#/components/schemas/Album');
      expect(schema.properties?.rotation?.$ref).toBe('#/components/schemas/RotationEntry');
      expect(schema.required).not.toContain('rotation');
    });

    it('bounds FilingRotationRequest.urls the same way as AddRotationRequest.urls', () => {
      const prop = propertyOf('FilingRotationRequest', 'urls');
      expect(prop?.maxItems).toBe(20);
      expect((prop?.items as Record<string, unknown>)?.maxLength).toBe(2048);
      expect(requiredKeysOf('FilingRotationRequest')).toEqual(['rotation_bin']);
    });

    it('defines POST /library/filings with an all-$ref request and response', () => {
      const post = (
        spec.paths['/library/filings'] as Record<string, Record<string, unknown>>
      ).post as {
        security?: unknown[];
        requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
        responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
      };
      expect(post).toBeDefined();
      expect(post.security).toEqual([{ BearerAuth: [] }]);
      expect(post.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/LibraryFilingRequest'
      );
      expect(post.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/LibraryFilingResponse'
      );
      expect(post.responses?.['400']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
      expect(post.responses?.['409']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/LibraryFilingConflictError'
      );
    });

    it('declares the filings 409 with the reason discriminant the composed writes emit', () => {
      // The two artist reasons are the exact strings Backend's deployed
      // addArtist answers with; rotation_card_bin_mismatch is defined here
      // contract-first for the rotation arm's card-bin invariant. A closed
      // enum: a new conflict reason is a contract change, not a free string.
      const reason = spec.components.schemas.LibraryFilingConflictReason as { enum?: string[] };
      expect(reason.enum).toEqual([
        'artist_code_conflict',
        'artist_name_conflict',
        'rotation_card_bin_mismatch',
      ]);
      const error = spec.components.schemas.LibraryFilingConflictError as {
        required?: string[];
        properties?: {
          reason?: { $ref?: string };
          artist?: { allOf?: Array<{ $ref?: string }> };
        };
      };
      expect(error.required).toEqual(['message', 'reason']);
      expect(error.properties?.reason?.$ref).toBe(
        '#/components/schemas/LibraryFilingConflictReason'
      );
      // The conflicting artist row is the payload a client acts on ("use
      // the existing artist instead") — typed, and optional because the
      // card-bin arm has no artist to name.
      expect(error.properties?.artist?.allOf?.[0]?.$ref).toBe('#/components/schemas/Artist');
      expect(error.required).not.toContain('artist');
    });
  });

  describe('DJ Schemas', () => {
    // DJ and NewDJ were pinned here until #372. They were the shapes of
    // GET /djs, POST /djs/register and PATCH /djs/register; `dj_route` mounts
    // only /djs/bin and /djs/playlists, so none of those three has ever been
    // served. NewDJ keyed on `cognito_user_name`, a string that appears nowhere
    // in Backend-Service source — the auth system it named was replaced by
    // better-auth long ago.
    it('no longer defines the Cognito-era DJ registration shapes', () => {
      expect(spec.components.schemas.DJ).toBeUndefined();
      expect(spec.components.schemas.NewDJ).toBeUndefined();
      // The surviving /djs surface is bin + playlists, and it has its own
      // shapes — this is a deletion of dead types, not of the DJ concept.
      expect(spec.components.schemas.BinEntry).toBeDefined();
      expect(spec.components.schemas.ShowPeek).toBeDefined();
    });

    it('should define BinEntry', () => {
      expect(spec.components.schemas.BinEntry).toBeDefined();
    });

    // Deleted, and asserted absent so they cannot return. This family modelled
    // a user-curated playlist -- `dj_id` plus a name plus ordered album entries
    // -- and no endpoint was ever built for it. The playlist surface this API
    // does serve is show-shaped and uses different types entirely:
    // `/flowsheet/playlist` returns `ShowPlaylist`, `/djs/playlists` returns
    // `ShowPeek`. `DJPlaylistsResponse` in particular is a shape-for-shape twin
    // of the live `DJBinResponse` it sat beside, which is why the components
    // table read as though both features existed. Only the bin one does.
    it.each([
      'Playlist',
      'PlaylistEntry',
      'PlaylistWithEntries',
      'DJPlaylistsResponse',
    ])('does not define %s', (name) => {
      expect(spec.components.schemas).not.toHaveProperty(name);
    });
  });

  describe('Schedule Schemas', () => {
    // ScheduleShift (and AddScheduleShiftRequest) were pinned here until #372.
    // Both were reachable only from GET /schedule/shifts; schedule.route.ts
    // serves GET/POST/PATCH/DELETE /schedule and nothing else.
    // #372's write-up expected these two to be deleted alongside
    // GET /schedule/shifts, on the reading that nothing else referenced them.
    // They ARE referenced: `POST /schedule` — a live route — declares
    // AddScheduleShiftRequest as its body and ScheduleShift as its response.
    // Deleting them would have stripped a working endpoint of its declaration,
    // so the contradiction was resolved the other way the ticket allowed, by
    // reconciling `day` onto the model the column actually has.
    it('keeps the shift shapes POST /schedule uses, on the database day model', () => {
      for (const name of ['ScheduleShift', 'AddScheduleShiftRequest']) {
        const day = (
          spec.components.schemas[name] as {
            properties: { day: { type?: string; minimum?: number; maximum?: number; $ref?: string } };
          }
        ).properties.day;
        expect(day.$ref, `${name}.day must not reintroduce the DayOfWeek enum`).toBeUndefined();
        expect(day.type, name).toBe('integer');
        expect(day.minimum, name).toBe(0);
        expect(day.maximum, name).toBe(6);
      }
    });

    // Deleted, and asserted absent so it cannot return. Specialty shows exist
    // in the schedule -- `Schedule.specialty_id` still carries the reference --
    // but no endpoint ever resolved one into a name and description, so this
    // shape described a lookup that is not offered.
    it('does not define SpecialtyShow', () => {
      expect(spec.components.schemas).not.toHaveProperty('SpecialtyShow');
    });
  });

  describe('Request Line Schemas', () => {
    it('should define SongRequest', () => {
      expect(spec.components.schemas.SongRequest).toBeDefined();
    });

    // Deleted, and asserted absent so they cannot return. `EnhancedRequest`
    // wrapped `SongRequest` with parse output and ranked `LibraryMatch`
    // candidates -- request-o-matic's enrichment result. That enrichment is
    // real, but it happens inside request-o-matic and its Slack post; this API
    // never returned it, and `SongRequest`/`ParsedSongRequest` (asserted above
    // and below) are the shapes that do cross the wire. `DeviceRegistration`
    // and `DeviceToken` were push-notification plumbing for a feature that was
    // never built and has no endpoint, no table, and no client.
    it.each([
      'EnhancedRequest',
      'LibraryMatch',
      'DeviceRegistration',
      'DeviceToken',
    ])('does not define %s', (name) => {
      expect(spec.components.schemas).not.toHaveProperty(name);
    });

    it('should define ParsedSongRequest', () => {
      expect(spec.components.schemas.ParsedSongRequest).toBeDefined();
    });

    it('should define RequestStatus enum', () => {
      const requestStatus = spec.components.schemas.RequestStatus as { enum?: string[] };
      expect(requestStatus).toBeDefined();
      expect(requestStatus.enum).toContain('pending');
      expect(requestStatus.enum).toContain('played');
      expect(requestStatus.enum).toContain('rejected');
    });
  });

  describe('Metadata Schemas', () => {
    it('should define AlbumMetadata', () => {
      expect(spec.components.schemas.AlbumMetadata).toBeDefined();
    });

    it('should define ArtistMetadata', () => {
      expect(spec.components.schemas.ArtistMetadata).toBeDefined();
    });

    it('should define MetadataSource enum', () => {
      const metadataSource = spec.components.schemas.MetadataSource as { enum?: string[] };
      expect(metadataSource).toBeDefined();
      expect(metadataSource.enum).toContain('discogs');
      expect(metadataSource.enum).toContain('spotify');
    });

    // Deleted, and asserted absent so they cannot return. These six mirrored
    // the raw Discogs API response verbatim -- no descriptions, Discogs's own
    // field names, an isolated `DiscogsRelease` tree plus a standalone
    // `DiscogsSearchResult`. No WXYC endpoint proxies Discogs unmodified, so
    // nothing ever referenced them: the shape this API actually serves is
    // `DiscogsMatchResult`, the processed result. Re-adding any of them
    // reintroduces an upstream vendor's schema into a contract that only
    // describes WXYC's own responses.
    it.each([
      'DiscogsSearchResult',
      'DiscogsArtistRef',
      'DiscogsLabelRef',
      'DiscogsTrack',
      'DiscogsImage',
      'DiscogsRelease',
    ])('does not define %s', (name) => {
      expect(spec.components.schemas).not.toHaveProperty(name);
    });

    it('should define TrackListItem schema', () => {
      const schema = spec.components.schemas.TrackListItem as {
        type: string;
        required: string[];
        properties: Record<string, { type: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['position', 'title']);
      expect(schema.properties.position!.type).toBe('string');
      expect(schema.properties.title!.type).toBe('string');
      expect(schema.properties.duration!.type).toBe('string');
    });

    it('should define ReconciledIdentity with bare external IDs', () => {
      const schema = spec.components.schemas.ReconciledIdentity as {
        type: string;
        properties: Record<string, { type: string; nullable?: boolean }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      // All six identifier fields are bare IDs, all nullable.
      // URL construction is the consumer's job — see WXYC/wxyc-shared#42.
      expect(schema.properties.discogs_artist_id!.type).toBe('integer');
      expect(schema.properties.discogs_artist_id!.nullable).toBe(true);
      expect(schema.properties.musicbrainz_artist_id!.type).toBe('string');
      expect(schema.properties.musicbrainz_artist_id!.nullable).toBe(true);
      expect(schema.properties.wikidata_qid!.type).toBe('string');
      expect(schema.properties.wikidata_qid!.nullable).toBe(true);
      expect(schema.properties.spotify_artist_id!.type).toBe('string');
      expect(schema.properties.spotify_artist_id!.nullable).toBe(true);
      expect(schema.properties.apple_music_artist_id!.type).toBe('string');
      expect(schema.properties.apple_music_artist_id!.nullable).toBe(true);
      expect(schema.properties.bandcamp_id!.type).toBe('string');
      expect(schema.properties.bandcamp_id!.nullable).toBe(true);
    });

    it('should attach optional reconciled_identity to LookupResultItem', () => {
      const schema = spec.components.schemas.LookupResultItem as {
        type: string;
        required: string[];
        properties: Record<string, { $ref?: string }>;
      };
      expect(schema).toBeDefined();
      // reconciled_identity is optional (not in `required`) and refs the shared schema
      expect(schema.required).toEqual(['library_item']);
      expect(schema.properties.reconciled_identity).toBeDefined();
      expect(schema.properties.reconciled_identity!.$ref).toBe(
        '#/components/schemas/ReconciledIdentity',
      );
    });
  });

  describe('Lookup Identity Block (cross-cache-identity §3.2.2)', () => {
    it('should define LookupRequest.include_identity as an optional boolean defaulting to false', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, { type?: string; default?: unknown }>;
        required?: string[];
      };
      expect(schema.properties.include_identity).toBeDefined();
      expect(schema.properties.include_identity!.type).toBe('boolean');
      expect(schema.properties.include_identity!.default).toBe(false);
      // Not required — v1 consumers continue to omit it.
      expect(schema.required ?? []).not.toContain('include_identity');
    });

    it('should add api_version to LookupResponse with enum [2] (absent for v1 shape)', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { type?: string; enum?: number[] }>;
        required?: string[];
      };
      expect(schema.properties.api_version).toBeDefined();
      expect(schema.properties.api_version!.type).toBe('integer');
      expect(schema.properties.api_version!.enum).toEqual([2]);
      // Not required — v1 responses omit the field entirely so existing
      // consumers see byte-identical responses.
      expect(schema.required ?? []).not.toContain('api_version');
    });

    it('should attach optional identity block to LookupResponse as a bare $ref', () => {
      // #316 tried wrapping this in `allOf` + `nullable: true` first (the
      // standard workaround for "sibling keys next to a bare $ref are
      // ignored"), but that made oasdiff report a spurious
      // response-required-property-removed on `identity/resolved` on top
      // of the expected became-nullable finding — LookupIdentityBlock.required
      // never changed, so the finding doesn't correspond to a real change
      // on the wire, but adding it to the whitelist would have gone beyond
      // what the ticket pre-authorized. Nullability lives on the
      // LookupIdentityBlock schema itself instead (see the dedicated test
      // below), so `identity` stays exactly the bare $ref it was on main.
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { $ref?: string; nullable?: boolean }>;
        required?: string[];
      };
      const identity = schema.properties.identity;
      expect(identity).toBeDefined();
      expect(identity!.$ref).toBe('#/components/schemas/LookupIdentityBlock');
      expect(identity!.nullable).toBeUndefined();
      expect(schema.required ?? []).not.toContain('identity');
    });

    it('declares LookupIdentityBlock itself nullable, because LML ships `"identity": null` on every response today', () => {
      const schema = spec.components.schemas.LookupIdentityBlock as { nullable?: boolean };
      expect(schema.nullable).toBe(true);
    });

    it('documents on LookupIdentityBlock why nullable lives on the schema rather than as an allOf sibling on the property', () => {
      const schema = spec.components.schemas.LookupIdentityBlock as { description?: string };
      const description = schema.description ?? '';
      expect(description).toMatch(/referenced exactly once/);
      expect(description).toMatch(/response-required-property-removed/);
    });

    it('documents on LookupIdentityBlock that identity ships null on every response and how a consumer should read it', () => {
      const schema = spec.components.schemas.LookupIdentityBlock as { description?: string };
      const description = schema.description ?? '';
      expect(description).toMatch(/`null`/);
      expect(description).toMatch(/api_version/);
      expect(description).not.toMatch(/byte-identical to v0\.5\.0/);
    });

    // --- #316: LookupResponse.api_version / identity ship `null` on every
    // `/lookup` response today, and the "byte-identical to v0.5.0 — both
    // omitted" claim never held ---
    //
    // LML serves this endpoint through FastAPI's `response_model` without
    // `response_model_exclude_none`, and no `LookupResponse(...)`
    // construction site (lookup/orchestrator.py L1343/L1368/L1653,
    // lookup/router.py L690/L812) ever sets either field — not even when
    // the request sets `include_identity: true`, because neither side of
    // the feature is implemented yet. So both fields sit at their `None`
    // default and FastAPI serializes `null`, which is not a valid instance
    // of `api_version`'s `enum: [2]`. This is the identical defect
    // WXYC/wxyc-shared#310 fixed on the sibling marker
    // `tracks_contract_version`.

    it('declares api_version nullable, because LML ships `"api_version": null` on every response today', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { nullable?: boolean }>;
      };
      expect(schema.properties.api_version!.nullable).toBe(true);
    });

    it('mandates a value-equality check on api_version and forbids a presence check', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.api_version!.description ?? '';
      expect(description).toMatch(/MUST test for the value `2`/);
      expect(description).toMatch(/must never test for key presence/);
    });

    it('explains why the value probe is required: absent, null, and an unimplemented producer must all read "not supported"', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.api_version!.description ?? '';
      expect(description).toMatch(/not supported/);
      expect(description).toMatch(/only the literal value `2` reads "supported"/);
    });

    it('corrects the LookupResponse schema-level description away from the false "byte-identical to v0.5.0 — both omitted" claim', () => {
      const schema = spec.components.schemas.LookupResponse as { description?: string };
      const description = schema.description ?? '';
      expect(description).not.toMatch(/byte-identical to v0\.5\.0/);
      expect(description).toMatch(/`null`/);
      expect(description).toMatch(/MUST test/);
    });

    it('corrects the include_identity request-field description away from the same false "byte-identical / omitted" claim', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.include_identity!.description ?? '';
      expect(description).not.toMatch(/byte-identical to v0\.5\.0/);
      expect(description).toMatch(/`null`/);
    });

    it('re-verifies the stale library-identity-writer.ts caller claim and drops the unverified assertion', () => {
      // A source read of Backend-Service (re-verified for this fix, same
      // SHA the original claim was read at: Backend-Service has not moved)
      // finds no `library-identity-writer.ts` file and no `include_identity`
      // reference anywhere in its TypeScript. The description must stop
      // asserting Backend as a live caller that sets this field.
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.include_identity!.description ?? '';
      expect(description).not.toMatch(/sets this to true on every call/);
    });

    it('should define IdentitySource enum with the six §3.2.0 sources', () => {
      const schema = spec.components.schemas.IdentitySource as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual([
        'discogs',
        'musicbrainz',
        'wikidata',
        'spotify',
        'apple_music',
        'bandcamp',
      ]);
    });

    it('should define IdentityMethod enum matching §3.4.1 methods', () => {
      const schema = spec.components.schemas.IdentityMethod as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual([
        'manual',
        'cross_source_agreement',
        'exact_match',
        'name_variation',
        'member_group',
        'alias_match',
        'trigram',
        'llm',
      ]);
    });

    it('should define IdentitySkipReason enum', () => {
      const schema = spec.components.schemas.IdentitySkipReason as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual([
        'error',
        'manual_override_protected',
        'disabled',
        'prerequisite_failed',
      ]);
    });

    it('should define IdentityResolution requiring source + attempted', () => {
      const schema = spec.components.schemas.IdentityResolution as {
        required: string[];
        properties: Record<string, { nullable?: boolean; $ref?: string; allOf?: unknown[] }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['source', 'attempted']);
      expect(schema.properties.source!.$ref).toBe('#/components/schemas/IdentitySource');
      // external_id, method, confidence, reason all nullable so a skipped
      // leg can NULL them.
      expect(schema.properties.external_id!.nullable).toBe(true);
      expect(schema.properties.confidence!.nullable).toBe(true);
    });

    it('should define LookupIdentityBlock with required `resolved` array', () => {
      const schema = spec.components.schemas.LookupIdentityBlock as {
        required: string[];
        properties: { resolved: { type: string; items: { $ref?: string } } };
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['resolved']);
      expect(schema.properties.resolved.type).toBe('array');
      expect(schema.properties.resolved.items.$ref).toBe(
        '#/components/schemas/IdentityResolution',
      );
    });
  });

  describe('Lookup Extended Metadata (subsecond iOS metadata path)', () => {
    type SchemaProp = {
      type?: string;
      default?: unknown;
      nullable?: boolean;
      format?: string;
      items?: { $ref?: string; type?: string };
      $ref?: string;
    };

    it('should define LookupRequest.extended as an optional boolean with no default', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };
      expect(schema.properties.extended).toBeDefined();
      expect(schema.properties.extended!.type).toBe('boolean');
      // Intentionally omit `default:` so openapi-typescript emits the field
      // as optional (`extended?: boolean`) rather than required. Existing
      // consumers (LML/BS/iOS/dj-site) keep compiling without passing it.
      expect(schema.properties.extended!.default).toBeUndefined();
      // Not required — non-iOS consumers continue to omit it.
      expect(schema.required ?? []).not.toContain('extended');
    });

    it('should define LookupRequest.warm_cache as an optional boolean with no default', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };
      expect(schema.properties.warm_cache).toBeDefined();
      expect(schema.properties.warm_cache!.type).toBe('boolean');
      // Same rationale as `extended` — see comment above.
      expect(schema.properties.warm_cache!.default).toBeUndefined();
      // Read-path callers leave this absent to avoid doubling Discogs-API load.
      expect(schema.required ?? []).not.toContain('warm_cache');
    });

    it('should attach artwork_checked_at to DiscogsReleaseMetadata as optional date-time', () => {
      // Additive nullable signal for LML's cache-hit predicate (WXYC/library-metadata-lookup#423).
      // Distinguishes "never asked" (NULL) from "asked, no cover" (timestamp set) so
      // LML stops re-fetching genuinely-imageless releases. Backed by the schema column in
      // WXYC/discogs-etl#239.
      const schema = spec.components.schemas.DiscogsReleaseMetadata as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };

      const prop = schema.properties.artwork_checked_at;
      expect(prop).toBeDefined();
      expect(prop!.type).toBe('string');
      expect(prop!.format).toBe('date-time');
      expect(prop!.nullable).toBe(true);
      // Must stay optional — required-list addition would break every existing
      // consumer of DiscogsReleaseMetadata (BS, dj-site, iOS, Android).
      expect(schema.required ?? []).not.toContain('artwork_checked_at');
    });

    it('should attach the extended-metadata fields to DiscogsMatchResult', () => {
      const schema = spec.components.schemas.DiscogsMatchResult as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };

      // Each new field is optional + nullable so the additive contract
      // doesn't break the LML/BS/iOS consumers that omit `extended`.
      const optional = (name: string) => {
        expect(schema.properties[name]).toBeDefined();
        expect(schema.required ?? []).not.toContain(name);
        expect(schema.properties[name]!.nullable).toBe(true);
      };

      optional('discogs_artist_id');
      expect(schema.properties.discogs_artist_id!.type).toBe('integer');

      optional('tracklist');
      expect(schema.properties.tracklist!.type).toBe('array');
      expect(schema.properties.tracklist!.items?.$ref).toBe(
        '#/components/schemas/DiscogsTrackItem',
      );

      optional('genres');
      expect(schema.properties.genres!.type).toBe('array');
      expect(schema.properties.genres!.items?.type).toBe('string');

      optional('styles');
      expect(schema.properties.styles!.type).toBe('array');
      expect(schema.properties.styles!.items?.type).toBe('string');

      optional('label');
      expect(schema.properties.label!.type).toBe('string');

      optional('full_release_date');
      expect(schema.properties.full_release_date!.type).toBe('string');

      optional('artist_image_url');
      expect(schema.properties.artist_image_url!.type).toBe('string');

      // Field name matches DiscogsArtistDetails.profile_tokens so iOS / dj-site
      // can share rendering code across the two payloads.
      optional('profile_tokens');
      expect(schema.properties.profile_tokens!.type).toBe('array');
      expect(schema.properties.profile_tokens!.items?.$ref).toBe(
        '#/components/schemas/DiscogsResolvedToken',
      );
    });

    it('should attach master_id to DiscogsMatchResult as an optional nullable integer', () => {
      // Phase-2 catalog popularity (WXYC/Backend-Service#1486, WXYC/library-metadata-lookup#688):
      // the release's Discogs master id, so a caller can collapse multiple
      // pressings/formats of one logical album into a single record keyed on
      // the master. Optional + nullable so the additive contract doesn't break
      // existing LML/BS/iOS/Android consumers; null when Discogs has no master.
      const schema = spec.components.schemas.DiscogsMatchResult as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };

      const prop = schema.properties.master_id;
      expect(prop).toBeDefined();
      expect(prop!.type).toBe('integer');
      expect(prop!.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('master_id');
    });

    it('should attach master_id to DiscogsReleaseMetadata as an optional nullable integer', () => {
      // Same Phase-2 master-collapse signal on the full release-metadata schema
      // (WXYC/library-metadata-lookup#688). Optional + nullable; null when Discogs
      // has no master for the release.
      const schema = spec.components.schemas.DiscogsReleaseMetadata as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };

      const prop = schema.properties.master_id;
      expect(prop).toBeDefined();
      expect(prop!.type).toBe('integer');
      expect(prop!.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('master_id');
    });

    it('should define DiscogsWriterCredits with names + provenance required (LML#699)', () => {
      // Songwriter/composer credits surfaced for BMI performance-list reporting
      // after the tubafrenzy turndown (WXYC/library-metadata-lookup#699). names +
      // provenance are required; roles + track_position are auxiliary/optional.
      const schema = spec.components.schemas.DiscogsWriterCredits as {
        properties: Record<string, SchemaProp & { enum?: string[] }>;
        required?: string[];
      };

      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['names', 'provenance']);
      expect(schema.properties.names!.type).toBe('array');
      expect(schema.properties.names!.items?.type).toBe('string');
      expect(schema.properties.provenance!.enum).toEqual(['track', 'release']);
      expect(schema.required ?? []).not.toContain('roles');
      expect(schema.required ?? []).not.toContain('track_position');
    });

    it('should attach writer_credits to DiscogsMatchResult as an optional $ref (LML#699)', () => {
      // writer_credits rides the album_metadata passthrough to Backend-Service; it
      // is a bare $ref kept OUT of `required`, so codegen emits it as optional and
      // the additive contract doesn't break existing LML/BS/iOS/Android consumers.
      const schema = spec.components.schemas.DiscogsMatchResult as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };

      expect(schema.properties.writer_credits).toBeDefined();
      expect(schema.properties.writer_credits!.$ref).toBe(
        '#/components/schemas/DiscogsWriterCredits',
      );
      expect(schema.required ?? []).not.toContain('writer_credits');
    });
  });

  describe('Lookup Hard Cap (LML#370)', () => {
    it('should add LookupResponse.timeout as an optional boolean defaulting to false', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { type?: string; default?: unknown; description?: string }>;
        required?: string[];
      };
      expect(schema.properties.timeout).toBeDefined();
      expect(schema.properties.timeout!.type).toBe('boolean');
      expect(schema.properties.timeout!.default).toBe(false);
      // Not required — existing consumers continue to ignore the field; new
      // consumers that read it can distinguish "no match" from "ran out of
      // time" on the LML hard-cap path.
      expect(schema.required ?? []).not.toContain('timeout');
    });

    it('should add LookupResponse.degraded as an optional boolean defaulting to false', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { type?: string; default?: unknown }>;
        required?: string[];
      };
      expect(schema.properties.degraded).toBeDefined();
      expect(schema.properties.degraded!.type).toBe('boolean');
      expect(schema.properties.degraded!.default).toBe(false);
      // Not required — existing consumers ignore it; new consumers distinguish a
      // deliberately shed-the-tail cache-only/partial result from both success
      // and a genuine no-match. Distinct from timeout (hard-cap abandonment).
      expect(schema.required ?? []).not.toContain('degraded');
    });

    it('should add LookupResponse.degraded_reason as an optional non-required reason enum', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { type?: string; enum?: string[] }>;
        required?: string[];
      };
      expect(schema.properties.degraded_reason).toBeDefined();
      expect(schema.properties.degraded_reason!.type).toBe('string');
      expect(schema.properties.degraded_reason!.enum).toEqual([
        'deadline_exceeded',
        'cache_only',
        'upstream_unavailable',
      ]);
      expect(schema.required ?? []).not.toContain('degraded_reason');
    });
  });

  describe('Lookup Multi-Location Union (transparent fold, supersedes LML#1018/#1022)', () => {
    it('should not define LookupRequest.include_locations — the union runs server-side, no opt-in', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties.include_locations).toBeUndefined();
    });

    it('should not define the removed separate LookupResponse locations field — locations fold into results instead', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties.also_available_on).toBeUndefined();
    });

    it('should not define a LibraryLocation schema — a folded location is an ordinary LookupResultItem', () => {
      expect(spec.components.schemas.LibraryLocation).toBeUndefined();
    });

    it("should broaden LookupResultItem.matched_via's description to name the location-union as a second producer", () => {
      const schema = spec.components.schemas.LookupResultItem as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.matched_via!.description ?? '';
      expect(description).toContain('SONG_AS_TRACK');
      expect(description).toContain('multi-location union');
      expect(description).toContain('discogs_release');
    });

    it('should leave the AlbumSearchResult.matched_via description untouched (BS catalog search, not the location union)', () => {
      const schema = spec.components.schemas.AlbumSearchResult as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.matched_via!.description ?? '';
      expect(description).toContain("Backend's catalog `/library/` search");
      expect(description).not.toContain('multi-location union');
    });

    it('should leave the LibrarySearchItem.matched_via description untouched (LML catalog search, not the location union)', () => {
      const schema = spec.components.schemas.LibrarySearchItem as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.matched_via!.description ?? '';
      expect(description).toContain('catalog-track-search plan §5.1');
      expect(description).not.toContain('multi-location union');
    });
  });

  // LibrarySearchItem carries two ids through a three-step, three-deploy
  // sequence (WXYC/Backend-Service#2167 -> WXYC/dj-site#1224 ->
  // WXYC/Backend-Service#2168) that moves `id` out of library.db's legacy
  // space and into Backend's serial `library.id`. The spaces are numerically
  // coextensive but unrelated: 87.7% of ids resolve to a *different real
  // release* in the opposite one (WXYC/dj-site#1179), so a consumer that
  // guesses wrong writes a silently wrong album link rather than missing.
  // Nothing in the wire shape distinguishes them — only these descriptions
  // do, which is why they are pinned rather than left to prose.
  describe('LibrarySearchItem id spaces (WXYC/Backend-Service#2167, step 1 of 3)', () => {
    type SchemaProp = {
      type?: string;
      nullable?: boolean;
      description?: string;
    };
    type Schema = {
      properties?: Record<string, SchemaProp>;
      required?: string[];
    };
    const item = () => spec.components.schemas.LibrarySearchItem as Schema;

    it('adds legacy_release_id as an optional nullable integer', () => {
      const field = item().properties?.legacy_release_id;
      expect(field).toBeDefined();
      expect(field!.type).toBe('integer');
      expect(field!.nullable).toBe(true);
      expect(item().required ?? []).not.toContain('legacy_release_id');
    });

    // Same openapi-typescript `defaultNonNullable` trap the BulkResolveInput
    // bridge field documents: a schema-level default emits the TS property
    // non-optional despite its absence from `required`.
    it('does not give legacy_release_id a schema-level default', () => {
      expect(item().properties?.legacy_release_id).not.toHaveProperty('default');
    });

    it('documents legacy_release_id as the library.db producer key, not the Backend serial', () => {
      const description = item().properties?.legacy_release_id?.description ?? '';
      expect(description).toMatch(/LIBRARY_RELEASE\.ID/);
      expect(description).toMatch(/library\.db/);
      expect(description).toMatch(/library\.id/);
    });

    // Present-but-null, not optional. Across the four generated targets that
    // is the smaller delta for every client: the property stays non-optional
    // and gains a nullable value, rather than every consumer having to handle
    // an absent key. `--strict-nullable` is what makes it expressible in the
    // Python models (see CLAUDE.md).
    it('makes id nullable while keeping it in required', () => {
      const field = item().properties?.id;
      expect(field!.type).toBe('integer');
      expect(field!.nullable).toBe(true);
      expect(item().required ?? []).toContain('id');
    });

    it('documents which space id is in, and confines the null to the Backend rewrite path', () => {
      const description = item().properties?.id?.description ?? '';
      expect(description).toMatch(/library\.id/);
      // The null is a property of Backend's proxy rewrite, not of LML.
      expect(description).toMatch(/proxy\/library\/search/);
      expect(description).toMatch(/never emits null/);
    });

    // library_url embeds the LEGACY id in its path and always will — the
    // dj-site front door it points at is the legacy resolver. Once step 3
    // moves `id` to serial, a description that calls that path segment "the
    // legacy library `id`" is pointing at the wrong field.
    it('does not let library_url describe its path segment as this row id', () => {
      const description = item().properties?.library_url?.description ?? '';
      expect(description).toMatch(/legacy_release_id/);
      expect(description).not.toMatch(/resolves the legacy\s+library `id`/);
    });
  });

  // GET /library/info takes two mutually-alternative identifiers, one per id
  // space. External callers — LML's `library_url`, the request line, the
  // wxyc.info permalink — hold the tubafrenzy legacy id; Backend's own clients
  // hold the serial. Declaring only `album_id`, and declaring it required, made
  // the legacy-keyed call the endpoint exists to serve inexpressible from a
  // generated client and rejectable by a spec-following validator.
  describe('/library/info identifier params', () => {
    type Param = {
      name: string;
      in: string;
      required?: boolean;
      description?: string;
      schema?: { type?: string };
    };
    const op = () =>
      (spec.paths['/library/info'] as { get: { parameters?: Param[]; description?: string } }).get;
    const param = (name: string) => op().parameters?.find((p) => p.name === name);

    it('declares legacy_release_id as an optional integer query param', () => {
      const p = param('legacy_release_id');
      expect(p).toBeDefined();
      expect(p!.in).toBe('query');
      expect(p!.schema?.type).toBe('integer');
      expect(p!.required ?? false).toBe(false);
    });

    it('names the id space legacy_release_id belongs to', () => {
      const description = param('legacy_release_id')?.description ?? '';
      expect(description).toMatch(/LIBRARY_RELEASE\.ID/);
      expect(description).toMatch(/library\.id/);
    });

    // The server 400s only when BOTH are absent, so a spec that marks this one
    // required contradicts the handler rather than merely under-describing it.
    it('does not mark album_id required', () => {
      const p = param('album_id');
      expect(p).toBeDefined();
      expect(p!.required ?? false).toBe(false);
    });

    // Precedence is the claim the ticket said to verify against the handler,
    // so it is the one that has to be pinned by more than a keyword: an edit
    // inverting it to "album_id wins" would keep a bare /legacy_release_id/
    // match green.
    it('documents that legacy_release_id wins on presence, not on value', () => {
      const description = op().description ?? '';
      expect(description).toMatch(/`legacy_release_id` wins whenever it is \*present\*/);
      expect(description).toMatch(/before looking at `album_id`/);
      expect(description).toMatch(/400 only when \*\*both\*\* are absent/);
    });

    // The two branches used to disagree on a miss — an unmatched album_id was
    // a 200 with an empty body while its sibling 404'd. BS#2212 unified them.
    // Pinned as a positive claim about agreement, plus a guard against the old
    // empty-body wording creeping back in alongside it.
    it('documents both branches 404ing a miss', () => {
      const description = op().description ?? '';
      expect(description).toMatch(/either unmatched\s+identifier is a 404/);
      expect(description).not.toMatch(/is a \*\*200 with\s+an empty body\*\*/);
    });

    // The defect BS#2212 fixed was silent: a truncated permalink resolved a
    // real, different release. The spec previously advertised that lenient
    // parse as intended behavior, so the wording is worth pinning.
    it('documents album_id as strictly parsed, naming the trailing-garbage case', () => {
      const description = param('album_id')?.description ?? '';
      expect(description).toMatch(/[Pp]arsed strictly/);
      expect(description).toMatch(/65880xyz/);
      expect(description).not.toMatch(/[Pp]arsed leniently/);
    });

    // A 404 that only exists in prose is unreachable from a generated client —
    // the exact complaint this ticket opens with, half-fixed.
    it('declares the 400 and 404 the operation actually returns', () => {
      const responses = (spec.paths['/library/info'] as { get: { responses?: Record<string, unknown> } })
        .get.responses ?? {};
      expect(Object.keys(responses).sort()).toEqual(['200', '400', '404']);
    });
  });

  // WXYC/wxyc-shared#365: four operations return getAlbumFromDB's row verbatim
  // and the spec modelled them with two schemas, one of them the catalog
  // *search* row. #52 is the precedent this deliberately declines to repeat --
  // it widened AlbumSearchResult to cover the missing/found endpoints, which
  // fixed two fields and entrenched the mis-modelling.
  describe('AlbumDetail is the one album-detail shape', () => {
    type Op = { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> };
    const okRef = (path: string, method: 'get' | 'patch') =>
      ((spec.paths[path] as Record<string, Op>)[method]!.responses ?? {})['200']?.content?.[
        'application/json'
      ]?.schema?.$ref;

    const DETAIL_OPERATIONS: Array<[string, 'get' | 'patch']> = [
      ['/library/info', 'get'],
      ['/library/{id}', 'patch'],
      ['/library/{id}/missing', 'patch'],
      ['/library/{id}/found', 'patch'],
    ];

    it.each(DETAIL_OPERATIONS)('%s %s returns AlbumDetail', (path, method) => {
      expect(okRef(path, method)).toBe('#/components/schemas/AlbumDetail');
    });

    // The seven properties AlbumSearchResult declares that no album-detail
    // handler emits. A future endpoint re-pointed at the search schema would
    // silently re-admit all of them, which is the failure this pins shut.
    const SEARCH_ONLY = [
      'album_dist',
      'artist_dist',
      'rotation_bin',
      'rotation_id',
      'artwork_url',
      'matched_via',
      'matched_via_alias',
    ];

    const detailProperties = (): Record<string, unknown> =>
      (spec.components.schemas.AlbumDetail as { properties: Record<string, unknown> }).properties;

    it.each(SEARCH_ONLY)('AlbumDetail does not declare the search-only property %s', (prop) => {
      expect(detailProperties()).not.toHaveProperty(prop);
    });

    // getAlbumFromDB projects no rotation columns at all, so the nested
    // `rotation` object AlbumInfoResponse carried described nothing.
    it('drops the rotation object no handler returns', () => {
      expect(detailProperties()).not.toHaveProperty('rotation');
    });

    // Load-bearing, not stylistic. The breaking-change gate's oasdiff compares
    // allOf branches one at a time, so an allOf-composed AlbumDetail read as
    // "removed ten required properties" on each of the three PATCHes it
    // replaced AlbumSearchResult on -- 30 errors for a change that removes
    // nothing. Reintroducing the composition would redden the gate again.
    it('stays a flat object rather than an allOf composition', () => {
      const schema = spec.components.schemas.AlbumDetail as {
        type?: string;
        allOf?: unknown;
      };
      expect(schema.type).toBe('object');
      expect(schema.allOf).toBeUndefined();
    });

    it('reuses the existing ReconciledIdentity schema rather than inlining it', () => {
      expect(detailProperties().reconciled_identity).toEqual({
        $ref: '#/components/schemas/ReconciledIdentity',
      });
    });

    // #52 added these two to AlbumSearchResult for the missing/found endpoints.
    // Those endpoints now point at AlbumDetail, but dj-site's
    // catalogSearchQueryMatch derives "currently missing" from them on SEARCH
    // rows, so they stay -- removing them here would be a real break.
    it.each(['date_lost', 'date_found'])('AlbumSearchResult keeps %s for its search consumers', (prop) => {
      const schema = spec.components.schemas.AlbumSearchResult as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty(prop);
    });
  });

  // WXYC/wxyc-shared#464: the release's definitive external links land on the
  // catalog read shapes and get a dedicated release-scoped write, all sharing
  // ONE `urls` vocabulary — position-ordered, replace-wholesale, bare-domain
  // tolerant (no `format: uri`), bounded at 20 links of 2048 chars. The bounds
  // mirror `RotationCreateFields.urls` (the filings/rotation-add path already
  // carries links); the standalone write here sets them independent of a
  // rotation stint (Backend storage: BS#2491).
  describe('release-level urls (#464)', () => {
    // Structural bounds only — the descriptions are tuned per site, so the one
    // `urls` vocabulary is pinned by identical SHAPE, not identical prose.
    const boundsOf = (prop: Record<string, unknown> | undefined) => ({
      type: prop?.type,
      maxItems: prop?.maxItems,
      items: prop?.items,
    });

    for (const schemaName of ['AlbumSearchResult', 'AlbumDetail'] as const) {
      it(`${schemaName} gains optional urls: a bounded array of plain strings, no format: uri`, () => {
        const prop = propertyOf(schemaName, 'urls');
        expect(prop).toBeDefined();
        expect(prop?.type).toBe('array');
        expect(prop?.maxItems).toBe(20);
        const items = prop?.items as Record<string, unknown> | undefined;
        expect(items?.type).toBe('string');
        expect(items?.maxLength).toBe(2048);
        expect(items?.format).toBeUndefined();
        expect(requiredKeysOf(schemaName)).not.toContain('urls');
      });
    }

    it('AlbumUrlsUpdate is the write shape: urls required, bounded identically', () => {
      const schema = spec.components.schemas.AlbumUrlsUpdate as {
        type?: string;
        required?: string[];
        properties?: Record<string, Record<string, unknown>>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['urls']);
      const prop = schema.properties?.urls;
      expect(prop?.type).toBe('array');
      expect(prop?.maxItems).toBe(20);
      const items = prop?.items as Record<string, unknown> | undefined;
      expect(items?.type).toBe('string');
      expect(items?.maxLength).toBe(2048);
      expect(items?.format).toBeUndefined();
    });

    it('read and write shapes carry the identical urls bounds — one vocabulary, not four hand-copies', () => {
      const search = boundsOf(propertyOf('AlbumSearchResult', 'urls'));
      const detail = boundsOf(propertyOf('AlbumDetail', 'urls'));
      const write = boundsOf(propertyOf('AlbumUrlsUpdate', 'urls'));
      const rotation = boundsOf(propertyOf('RotationCreateFields', 'urls'));
      expect(detail).toEqual(search);
      expect(write).toEqual(search);
      expect(rotation).toEqual(search);
    });

    it('declares PUT /library/{id}/urls under BearerAuth, taking AlbumUrlsUpdate and returning AlbumDetail', () => {
      const put = (spec.paths['/library/{id}/urls'] as Record<string, unknown> | undefined)?.put as
        | {
            'x-wxyc-service'?: string;
            security?: Array<Record<string, unknown>>;
            requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
            responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
          }
        | undefined;
      expect(put).toBeDefined();
      expect(put?.['x-wxyc-service']).toBe('backend-service');
      expect(put?.security).toEqual([{ BearerAuth: [] }]);
      expect(put?.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/AlbumUrlsUpdate'
      );
      expect(put?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/AlbumDetail'
      );
      expect(put?.responses?.['404']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ApiErrorResponse'
      );
    });
  });

  // WXYC/wxyc-shared#367: `Genre` was a closed ten-value enum while production
  // holds fifteen, and it declared an `Unknown` the genres table has never
  // had -- because it was transcribed from dj-site's UI union, not the DB.
  // `Format` was the same artifact, already orphaned.
  describe('genre and format are open sets', () => {
    it.each(['Genre', 'Format'])('deletes the %s pseudo-enum component', (name) => {
      expect(spec.components.schemas).not.toHaveProperty(name);
    });

    it('leaves no $ref pointing at either deleted component', () => {
      const source = JSON.stringify(spec);
      expect(source).not.toMatch(/#\/components\/schemas\/Genre(?![A-Za-z])/);
      expect(source).not.toMatch(/#\/components\/schemas\/Format(?![A-Za-z])/);
    });

    // The SSOT used to contradict itself: AlbumSearchResult.genre_name was a
    // free string while AlbumInfoResponse.genre_name was the enum, for
    // responses Backend serves from the identical projection.
    it('types genre_name as a plain string everywhere it appears', () => {
      const sites: Array<{ label: string; get: () => { type?: string; $ref?: string } }> = [
        {
          label: 'GenreEntry',
          get: () =>
            (spec.components.schemas.GenreEntry as { properties: Record<string, { type?: string }> })
              .properties.genre_name!,
        },
        {
          label: 'AlbumSearchResult',
          get: () =>
            (
              spec.components.schemas.AlbumSearchResult as {
                properties: Record<string, { type?: string }>;
              }
            ).properties.genre_name!,
        },
        {
          label: 'AlbumDetail',
          get: () =>
            (spec.components.schemas.AlbumDetail as { properties: Record<string, { type?: string }> })
              .properties.genre_name!,
        },
      ];

      for (const site of sites) {
        expect({ [site.label]: site.get().type }).toEqual({ [site.label]: 'string' });
      }
    });

    // The list of current values lives in a description, and a description can
    // rot. Naming the endpoint is what keeps a reader from treating the
    // snapshot as the contract -- that is the whole remedy for this defect.
    it('names GET /library/genres as the authoritative enumeration', () => {
      const description =
        (spec.components.schemas.GenreEntry as { description?: string }).description ?? '';
      expect(description).toMatch(/GET \/library\/genres/);
    });
  });

  describe('Proxy Response Schemas', () => {
    it('should define AlbumMetadataResponse with enriched fields', () => {
      const schema = spec.components.schemas.AlbumMetadataResponse as {
        properties: Record<string, { type: string; items?: { $ref?: string } }>;
      };
      expect(schema.properties.genres).toBeDefined();
      expect(schema.properties.genres!.type).toBe('array');
      expect(schema.properties.styles).toBeDefined();
      expect(schema.properties.styles!.type).toBe('array');
      expect(schema.properties.label).toBeDefined();
      expect(schema.properties.label!.type).toBe('string');
      expect(schema.properties.discogsArtistId).toBeDefined();
      expect(schema.properties.discogsArtistId!.type).toBe('integer');
      expect(schema.properties.fullReleaseDate).toBeDefined();
      expect(schema.properties.fullReleaseDate!.type).toBe('string');
      expect(schema.properties.tracklist).toBeDefined();
      expect(schema.properties.tracklist!.type).toBe('array');
      expect(schema.properties.tracklist!.items?.$ref).toBe('#/components/schemas/TrackListItem');
    });

    it('should define ArtistMetadataResponse with imageUrl', () => {
      const schema = spec.components.schemas.ArtistMetadataResponse as {
        properties: Record<string, { type: string }>;
      };
      expect(schema.properties.imageUrl).toBeDefined();
      expect(schema.properties.imageUrl!.type).toBe('string');
    });

    it('should define ArtistMetadataResponse.bioTokens as a nullable array of DiscogsResolvedToken (#251)', () => {
      const schema = spec.components.schemas.ArtistMetadataResponse as {
        properties: Record<string, { type?: string; nullable?: boolean; items?: { $ref?: string } }>;
        required?: string[];
      };
      expect(schema.properties.bioTokens).toBeDefined();
      expect(schema.properties.bioTokens!.type).toBe('array');
      // The backend emits an explicit `?? null` for this field.
      expect(schema.properties.bioTokens!.nullable).toBe(true);
      // Reuses the existing token schema (pass-through of
      // DiscogsArtistDetails.profile_tokens) — no parallel token shape.
      expect(schema.properties.bioTokens!.items?.$ref).toBe(
        '#/components/schemas/DiscogsResolvedToken'
      );
      // Not required — additive/optional, existing consumers are unaffected.
      expect(schema.required ?? []).not.toContain('bioTokens');
    });
  });

  // AppConfig is served unauthenticated from GET /config at app bootstrap and
  // is the only remote-config surface the mobile clients have. Two properties
  // here are load-bearing beyond their shape, so they get their own pins:
  // the exact key spellings (frozen against a consumer that decodes them by
  // literal name) and their absence from `required` (see the block comment on
  // the non-required test below for why that one is a safety property, not a
  // style choice). Decision trail: #338, WXYC/Backend-Service#2111,
  // WXYC/wxyc-ios-64#912.
  describe('AppConfig donate fields (#338 / BS#2111)', () => {
    interface AppConfigSchema {
      required?: string[];
      properties: Record<string, { type?: string; description?: string; nullable?: boolean }>;
    }

    const appConfig = (): AppConfigSchema => spec.components.schemas.AppConfig as AppConfigSchema;

    it('declares donateUrl as a string', () => {
      const field = appConfig().properties.donateUrl;
      expect(field).toBeDefined();
      expect(field!.type).toBe('string');
    });

    it('declares donateEnabled as a boolean', () => {
      const field = appConfig().properties.donateEnabled;
      expect(field).toBeDefined();
      expect(field!.type).toBe('boolean');
    });

    // The constraint the whole slice rests on. iOS's AppConfig decoder is
    // hand-written and returns a wholesale hardcoded default on ANY decode
    // failure — silently discarding the remote PostHog key and apiBaseUrl
    // along with the donate fields. Promoting either field into `required`
    // arms that cascade on every version skew (backend rollback, stale cached
    // /config response, an iOS build shipping ahead of the backend deploy).
    // Nothing else in CI catches the promotion: oasdiff treats adding a
    // required response property as non-breaking, so this assertion is the
    // only guard. Non-required means a skewed client still decodes the
    // response, keeps its remote PostHog key and apiBaseUrl, and merely falls
    // through to its own compile-time donate default — rather than losing
    // every remote value at once. See WXYC/wxyc-ios-64#912 and this repo's
    // #338.
    it('keeps both donate fields out of required, so a skewed client keeps its remote config instead of falling back wholesale', () => {
      const required = appConfig().required ?? [];
      expect(required).not.toContain('donateUrl');
      expect(required).not.toContain('donateEnabled');
      // The pre-existing four are untouched by the donate slice.
      expect(required).toEqual(['posthogApiKey', 'posthogHost', 'requestOMaticUrl', 'apiBaseUrl']);
    });

    // Backend-Service serves donateUrl as '' (never null) when DONATE_URL is
    // unset — BS#2111 reads it as `process.env.DONATE_URL || ''`. So the
    // field is neither nullable nor `format: uri`: '' is a valid value on the
    // wire and would fail uri validation. Clients collapse '' and absent to
    // the same "no remote destination" reading and fall through to their
    // own fallback.
    it('documents the empty-string-when-unset wire value without declaring nullable or a uri format', () => {
      const field = appConfig().properties.donateUrl;
      expect(field!.description ?? '').toMatch(/empty string/i);
      expect(field!.nullable).toBeUndefined();
      expect(field).not.toHaveProperty('format');
    });

    // The two env vars are independent on one deploy, so enabled-with-no-URL
    // is reachable. iOS resolves it via a fallback ladder that always ends at
    // a compile-time URL, but nothing structural stops another client from
    // rendering an enabled button with no destination — the contract has to
    // say which field decides what.
    it('resolves the enabled-with-unusable-url state rather than leaving it to each client', () => {
      const description = appConfig().properties.donateUrl!.description ?? '';
      expect(description).toMatch(/MUST NOT render/);
      expect(description).toMatch(/independent variables/i);
    });

    // `false` hides the entry point; absent does NOT mean hidden. The
    // dark-ship guarantee is carried by each client's own bootstrap default,
    // not by omission, so the description must not promise hide-on-absent —
    // the sole frozen consumer resolves absent to *visible*
    // (`donateEnabled ?? true` in wxyc-ios-64#913).
    it('documents donateEnabled as hide-on-false, client-default-on-absent, and absence as explicitly not a kill switch', () => {
      const description = appConfig().properties.donateEnabled!.description ?? '';
      expect(description).toMatch(/false/);
      expect(description).toMatch(/absent/i);
      expect(description).toMatch(/default/i);
      expect(description).toMatch(/NOT a kill switch/i);
    });

    // The propagation floor is ~1h of public cache plus an unbounded
    // in-process cache, so `false` is a deploy-time switch. BS#2111 documents
    // this and so does the iOS PR; api.yaml is what the Android and website
    // implementers read instead, so it has to carry it too.
    it('warns that false propagates on a deploy-time, cache-bounded schedule rather than instantly', () => {
      const description = appConfig().properties.donateEnabled!.description ?? '';
      expect(description).toMatch(/max-age=3600/);
      expect(description).toMatch(/deploy-time/i);
    });

    // Guards the fix for the trap, not just the wording: a schema-level
    // `default` would make openapi-typescript emit the property as
    // non-optional even though it is absent from `required` — the exact
    // cascade the non-required constraint exists to prevent. Same precedent
    // as BulkResolveLibrariesRequest.include_tracks.
    it('declares no schema-level default on either field, and records why', () => {
      expect(appConfig().properties.donateEnabled).not.toHaveProperty('default');
      expect(appConfig().properties.donateUrl).not.toHaveProperty('default');
      expect(appConfig().properties.donateEnabled!.description ?? '').toMatch(
        /no schema-level `default`/
      );
    });

    // The key spellings are frozen against WXYC/wxyc-ios-64#913, whose
    // hand-written decoder matches on these literals; renaming either side
    // alone silently decodes to nil rather than failing loudly.
    it('freezes the key spellings the iOS consumer decodes', () => {
      expect(Object.keys(appConfig().properties)).toEqual(
        expect.arrayContaining(['donateUrl', 'donateEnabled'])
      );
    });
  });

  // AppSecrets is served from GET /config/secrets, the authenticated sibling
  // of the unauthenticated GET /config above. Shape mirrors Backend-Service's
  // AppSecrets interface (apps/backend/controllers/config.controller.ts) —
  // no credential values appear anywhere in this spec, only the response
  // shape. Decision trail: #341, #338/#339 (the AppConfig precedent).
  describe('AppSecrets / GET /config/secrets (#341)', () => {
    interface AppSecretsSchema {
      required?: string[];
      properties: Record<string, { type?: string; description?: string }>;
    }

    const appSecrets = (): AppSecretsSchema =>
      spec.components.schemas.AppSecrets as AppSecretsSchema;

    it('defines the AppSecrets schema', () => {
      expect(appSecrets()).toBeDefined();
    });

    it('declares discogsApiKey and discogsApiSecret as required strings', () => {
      const schema = appSecrets();
      expect(schema.properties.discogsApiKey?.type).toBe('string');
      expect(schema.properties.discogsApiSecret?.type).toBe('string');
      expect(schema.required).toEqual(
        expect.arrayContaining(['discogsApiKey', 'discogsApiSecret'])
      );
    });

    // Field names are frozen against the live wire — iOS decodes them by
    // literal name in AppConfiguration.fetchSecrets.
    it('freezes the key spellings the iOS consumer decodes', () => {
      expect(Object.keys(appSecrets().properties)).toEqual(
        expect.arrayContaining(['discogsApiKey', 'discogsApiSecret'])
      );
    });

    it('defines GET /config/secrets requiring bearer auth', () => {
      const path = spec.paths['/config/secrets'] as {
        get?: {
          security?: Array<Record<string, unknown>>;
          responses?: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }>;
        };
      };
      expect(path).toBeDefined();
      expect(path.get).toBeDefined();
      // Explicitly declared (not just inherited) so codegen consumers don't
      // mistake this for public bootstrap config like /config.
      expect(path.get!.security).toEqual([{ BearerAuth: [] }]);
      const responseSchema =
        path.get!.responses?.['200']?.content?.['application/json']?.schema;
      expect(responseSchema?.$ref).toBe('#/components/schemas/AppSecrets');
    });

    // Backend-Service serves both fields as '' (never null, never omitted)
    // when their env var is unset — config.controller.ts reads
    // `process.env.DISCOGS_API_KEY || ''` / `process.env.DISCOGS_API_SECRET
    // || ''`, the same fallback shape #338/BS#2111 documented for
    // donateUrl. Unlike donateUrl, this field carries no fallback-worthy
    // "absent means use my own default" reading — an empty credential is
    // simply an unusable one, so the description says so rather than
    // instructing a client-side substitution.
    it('documents the empty-string-when-unset wire value for both fields', () => {
      const schema = appSecrets();
      expect(schema.properties.discogsApiKey?.description ?? '').toMatch(/empty string/i);
      expect(schema.properties.discogsApiSecret?.description ?? '').toMatch(/empty string/i);
    });

    // Unlike the donate fields (#338), both fields here stay required: the
    // handler always emits both keys (via `|| ''`), so a spec-conformant
    // producer never triggers the failure mode. The description has to say
    // what happens if a *future* producer ever omits one anyway, since that
    // is the scenario `required` arms.
    it('justifies the required choice and states the decode consequence of a producer omitting a field', () => {
      const description = appSecrets().properties.discogsApiKey?.description ?? '';
      expect(description).toMatch(/required/i);
      expect(description).toMatch(/decode/i);
    });

    // No counterpart to /config's 3600s public-cache note existed here
    // before this ticket. Backend-Service marks the response
    // `private, max-age=3600` (config.controller.ts getSecrets) — private
    // because it carries per-deploy credentials that must not be cached by
    // a shared proxy, unlike /config's public bootstrap data.
    it('states the response cache semantics on the path description', () => {
      const path = spec.paths['/config/secrets'] as { get?: { description?: string } };
      const description = path.get?.description ?? '';
      // Pin the header literal itself, not just its words: /private/i alone
      // is satisfied by surrounding prose, so a flip of the documented
      // header to `public` would slip through a looser match.
      expect(description).toMatch(/Cache-Control:\s*private,\s*max-age=3600/);
      // And pin the rotation bound as a floor ("an hour or more"), so a
      // later edit can't quietly turn it back into a ceiling — decoded
      // credentials outlive the HTTP cache for the process lifetime.
      expect(description).toMatch(/an hour or more/i);
    });
  });

  describe('API Endpoints', () => {
    it('should define /flowsheet endpoint', () => {
      expect(spec.paths['/flowsheet']).toBeDefined();
    });

    it('should define /library endpoint', () => {
      expect(spec.paths['/library']).toBeDefined();
    });

    // Was `/djs`, which nothing serves. `dj_route` mounts only these two.
    it('should define the /djs endpoints dj_route actually serves', () => {
      expect(spec.paths['/djs/bin']).toBeDefined();
      expect(spec.paths['/djs/playlists']).toBeDefined();
    });

    it('should define /schedule endpoint', () => {
      expect(spec.paths['/schedule']).toBeDefined();
    });

    // Singular. Was `/requests`, which nothing serves; Backend mounts
    // request_line_route at `/request`.
    it('should define /request endpoint', () => {
      expect(spec.paths['/request']).toBeDefined();
    });

    // Was `/metadata/album`, a duplicate declaration of a path that only ever
    // existed under the `/proxy` prefix.
    it('should define /proxy/metadata/album endpoint', () => {
      expect(spec.paths['/proxy/metadata/album']).toBeDefined();
    });

    it('should define /events/stream as a public GET (no security)', () => {
      const path = spec.paths['/events/stream'] as {
        get?: { security?: unknown[]; parameters?: Array<{ name: string }> };
      };
      expect(path).toBeDefined();
      expect(path.get).toBeDefined();
      // security: [] explicitly opts out of the inherited BearerAuth.
      // Browser EventSource can't attach an Authorization header — the
      // public-topic path is the contract.
      expect(path.get!.security).toEqual([]);
      // `?topics=<csv>` is the wire shape — comma-separated topic strings.
      const topics = path.get!.parameters?.find((p) => p.name === 'topics');
      expect(topics).toBeDefined();
    });
  });

  describe('Live-Updates SSE Schemas (live-updates-sse plan)', () => {
    it('should define LiveFsUpdateEvent with the {type, payload, timestamp} envelope', () => {
      const schema = spec.components.schemas.LiveFsUpdateEvent as {
        type: string;
        required: string[];
        properties: Record<string, { enum?: string[]; $ref?: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['type', 'payload', 'timestamp']);
      expect(schema.properties.type!.enum).toEqual(['update']);
      // Payload is the full flowsheet row — pinned by
      // CONTRACTS.LIVE_FS_UPDATE_INCLUDES_FULL_ROW.
      expect(schema.properties.payload!.$ref).toBe('#/components/schemas/FlowsheetEntryResponse');
    });

    it('should define LiveFsRefetchEvent with the {type, payload, timestamp} envelope', () => {
      const schema = spec.components.schemas.LiveFsRefetchEvent as {
        type: string;
        required: string[];
        properties: Record<string, { enum?: string[] }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['type', 'payload', 'timestamp']);
      expect(schema.properties.type!.enum).toEqual(['refetch']);
    });

    it('should define LiveFsInsertEvent with the {type, payload, timestamp} envelope', () => {
      const schema = spec.components.schemas.LiveFsInsertEvent as {
        type: string;
        required: string[];
        properties: Record<string, { enum?: string[]; $ref?: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['type', 'payload', 'timestamp']);
      expect(schema.properties.type!.enum).toEqual(['insert']);
      // Carries the full newly-inserted flowsheet row — same payload shape as
      // LiveFsUpdateEvent, valid pre-enrichment (metadata_status 'pending',
      // enrichment fields nullable on FlowsheetEntryResponse).
      expect(schema.properties.payload!.$ref).toBe('#/components/schemas/FlowsheetEntryResponse');
    });

    it('should define LiveFsEvent as a discriminated union over `type`', () => {
      const schema = spec.components.schemas.LiveFsEvent as {
        oneOf: Array<{ $ref: string }>;
        discriminator: { propertyName: string; mapping: Record<string, string> };
      };
      expect(schema).toBeDefined();
      expect(schema.oneOf).toHaveLength(3);
      expect(schema.discriminator.propertyName).toBe('type');
      expect(schema.discriminator.mapping.update).toContain('LiveFsUpdateEvent');
      expect(schema.discriminator.mapping.refetch).toContain('LiveFsRefetchEvent');
      expect(schema.discriminator.mapping.insert).toContain('LiveFsInsertEvent');
    });

  });

  describe('Per-Service Streaming Resolution Status (LML#1053)', () => {
    it('defines StreamingResolutionStatus as a closed verified/absent/unresolved enum', () => {
      const schema = spec.components.schemas.StreamingResolutionStatus as {
        type?: string;
        enum?: string[];
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('string');
      expect(schema.enum).toEqual(['verified', 'absent', 'unresolved']);
    });

    it('defines StreamingResolution with per-service optional (non-nullable) status refs', () => {
      const schema = spec.components.schemas.StreamingResolution as {
        type?: string;
        properties: Record<string, { $ref?: string; nullable?: boolean }>;
        required?: string[];
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      for (const svc of ['spotify', 'apple_music', 'bandcamp']) {
        const prop = schema.properties[svc];
        expect(prop, `${svc} property`).toBeDefined();
        expect(prop!.$ref).toBe('#/components/schemas/StreamingResolutionStatus');
        // Optional but NOT nullable: never-consulted is encoded solely by key
        // omission; a consulted-but-absent service is the `absent` verdict — so
        // `null` would be a redundant second encoding of never-consulted.
        expect(prop!.nullable).toBeUndefined();
      }
      // Every per-service status is optional: a service key is present only when
      // that service was consulted this lookup. An omitted service was never
      // probed and must NOT be read as `absent` (the never-consulted state).
      expect(schema.required ?? []).toEqual([]);
    });

    it('attaches streaming_status to DiscogsMatchResult as an optional nullable $ref', () => {
      const schema = spec.components.schemas.DiscogsMatchResult as {
        properties: Record<string, { nullable?: boolean; allOf?: Array<{ $ref?: string }> }>;
        required?: string[];
      };
      expect(schema.properties.streaming_status).toBeDefined();
      expect(schema.properties.streaming_status!.nullable).toBe(true);
      expect(schema.properties.streaming_status!.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/StreamingResolution',
      );
      // Additive: not required, so existing LML/BS consumers are unaffected and a
      // null/omitted object means "no per-service status resolved on this path"
      // (e.g. an LML predating the producer rollout). Does not change the meaning
      // of the sibling `*_url` fields — it only annotates why a url is null.
      expect(schema.required ?? []).not.toContain('streaming_status');
    });
  });

  describe('Streaming URL fields carry format: uri (#428, #431)', () => {
    // The five streaming URL fields, at every schema that carries them.
    // FlowsheetEntryFields and FlowsheetV2TrackEntry are the two flowsheet
    // shapes; AlbumMetadata is the cache row; StreamingLinks is the shared
    // sub-schema; DiscogsMatchResult is the LML lookup result. `propertyOf`
    // follows `allOf`/`$ref` so the two flowsheet composites resolve the
    // same way the runtime consumers see them.
    //
    // #431 collapses 25 copy-pasted descriptions into TWO anchored notes, not
    // one: YAML cannot concatenate scalars, and the album-deep-link vs
    // search-URL distinction in the lead sentence is load-bearing --
    // `StreamingResolution` carries a verdict for exactly the three deep-link
    // services and none for the two search-URL ones, and the BS guard's own
    // doc comment leans on the same split.
    const ALBUM_URL_FIELDS = ['spotify_url', 'apple_music_url', 'bandcamp_url'];
    const SEARCH_URL_FIELDS = ['youtube_music_url', 'soundcloud_url'];
    const STREAMING_URL_FIELDS = [...ALBUM_URL_FIELDS, ...SEARCH_URL_FIELDS];
    const SCHEMAS_WITH_STREAMING_URLS = [
      'FlowsheetEntryFields',
      'FlowsheetV2TrackEntry',
      'AlbumMetadata',
      'StreamingLinks',
      'DiscogsMatchResult',
    ];

    function countOccurrences(haystack: string, needle: string): number {
      return haystack.split(needle).length - 1;
    }

    for (const schemaName of SCHEMAS_WITH_STREAMING_URLS) {
      for (const field of STREAMING_URL_FIELDS) {
        it(`declares ${schemaName}.${field} as format: uri, nullable, sharing the one enforcement note`, () => {
          const prop = propertyOf(schemaName, field);
          expect(prop, `${schemaName}.${field}`).toBeDefined();
          expect(prop!.format).toBe('uri');
          // Nullable everywhere these fields appear (bounced-PR fix:
          // AlbumMetadata originally omitted this, the one schema of the
          // five that didn't declare it, even though Backend-Service's
          // album-metadata-projection.ts reads these columns as a genuine
          // SQL NULL via `coalesce(album_metadata.X, flowsheet.X)`, typed
          // `string | null` — never an omitted key).
          expect(prop!.nullable, `${schemaName}.${field}.nullable`).toBe(true);
          const description = String(prop!.description ?? '');
          // #431: post-#2351/#1296, enforcement actually shipped, so the
          // description says so in present tense — it no longer forbids
          // that wording the way the pre-#431 pin did. It still names both
          // seams and the deliberate per-seam bandcamp disagreement (a
          // description that said "bandcamp is host-checked" flatly would
          // be wrong at the BS boundary, which only checks well-formedness
          // there).
          expect(description).toMatch(/Backend-Service#2351/);
          expect(description).toMatch(/library-metadata-lookup#1296/);
          expect(description).toMatch(/sanitizeLookupStreamingUrls/);
          expect(description).toMatch(/streaming_link_validation\.py/);
          expect(description).toMatch(/bandcamp/i);
          expect(description).not.toMatch(/both are open/);
          expect(description).not.toMatch(/neither has merged/);
          // LML#1296's guard suppresses on the read path; it never rewrites
          // the persisted `streaming_links` row, so a "writer seam" label
          // would read as a backfill that never happens. Pin the label too,
          // not just the parenthetical: the first #431 attempt added the
          // clarifier while leaving the contradictory label in place, and
          // an assertion on the parenthetical alone was satisfied by it.
          expect(description).toMatch(/the persisted row is never rewritten/);
          expect(description).not.toMatch(/writer seam/);
          // Naming two shipped seams must not imply they are the only paths
          // to the wire. The pre-#431 text carried this caveat, the dedup
          // dropped it, and nothing failed — so pin it, along with the
          // measured instance: flowsheet-projection.ts host-guards only
          // spotify/apple and emits the other three as stored.
          expect(description).toMatch(/not every path these fields reach the wire through/);
          expect(description).toMatch(/Backend-Service#1714/);
          // Kotlin is NOT a documentation-only consumer: openapi-generator's
          // kotlin generator emits `val spotifyUrl: java.net.URI? = null`, a
          // construction-time parse of stored values — exactly the decode
          // hazard #428 exists to avoid. Pinning that claim so a future
          // "all consumers treat this as documentation" simplification of
          // the note has to fail here first.
          expect(description).toMatch(/java\.net\.URI/);
          expect(description).toMatch(/Kotlin does not treat it as documentation-only/);
          // The Python `str` is this repo's pin, not an already-universal
          // fact: LML and request-o-matic still run unmigrated regen
          // scripts, so their current `str` is stale-derived.
          expect(description).toMatch(/library-metadata-lookup#1299/);
          expect(description).toMatch(/request-o-matic#282/);

          if (ALBUM_URL_FIELDS.includes(field)) {
            expect(description).toMatch(/^Album deep link/);
            // The split-seam exception is bandcamp-only, so it is named
            // rather than left as a deictic "this field" that would travel
            // through the alias onto the other four fields.
            expect(description).toMatch(/`bandcamp_url` is not host-checked at every seam/);
            expect(description).not.toMatch(/this field is not host-checked/);
          } else {
            expect(description).toMatch(/^Search URL/);
            // Neither search field has a split-seam exception, so the
            // clause is absent from the search note entirely.
            expect(description).not.toMatch(/is not host-checked at every seam/);
          }
        });
      }
    }

    // The parsed tree cannot see the anchor: js-yaml/`yaml` resolve aliases
    // during parse, so 25 hand-pasted identical copies satisfy every
    // description assertion above just as well as the anchors do. These two
    // assertions read the raw source instead, and are the only thing in the
    // suite that can tell a shared anchor from a re-pasted copy.
    it('defines exactly two streaming-URL note anchors in the raw spec source (#431)', () => {
      expect(countOccurrences(specText, '&streaming-url-note-album')).toBe(1);
      expect(countOccurrences(specText, '&streaming-url-note-search')).toBe(1);
      // No stray third anchor, and no leftover single-anchor name from the
      // pre-split revision of #431.
      expect(specText.match(/&streaming-url-note[\w-]*/g)).toEqual([
        '&streaming-url-note-album',
        '&streaming-url-note-search',
      ]);
    });

    it('references those anchors 23 times in the raw spec source, never re-pasting the note (#431)', () => {
      // 25 field/schema pairs = 2 anchor definitions + 23 aliases.
      // 3 album fields x 5 schemas = 15 sites, one of which is the definition.
      expect(countOccurrences(specText, '*streaming-url-note-album')).toBe(14);
      // 2 search fields x 5 schemas = 10 sites, one of which is the definition.
      expect(countOccurrences(specText, '*streaming-url-note-search')).toBe(9);
      expect(specText.match(/\*streaming-url-note[\w-]*/g)).toHaveLength(23);
    });

    it('resolves to exactly two description strings, partitioned album vs search (#431)', () => {
      const byDescription = new Map<string, string[]>();
      for (const schemaName of SCHEMAS_WITH_STREAMING_URLS) {
        for (const field of STREAMING_URL_FIELDS) {
          const description = String(propertyOf(schemaName, field)!.description ?? '');
          const sites = byDescription.get(description) ?? [];
          sites.push(`${schemaName}.${field}`);
          byDescription.set(description, sites);
        }
      }
      // Two identity classes, not one (the album/search lead differs) and not
      // 25 (that would mean the anchors were re-expanded into copies).
      expect(byDescription.size).toBe(2);

      const expectedAlbumSites = SCHEMAS_WITH_STREAMING_URLS.flatMap((s) =>
        ALBUM_URL_FIELDS.map((f) => `${s}.${f}`)
      );
      const expectedSearchSites = SCHEMAS_WITH_STREAMING_URLS.flatMap((s) =>
        SEARCH_URL_FIELDS.map((f) => `${s}.${f}`)
      );
      expect(expectedAlbumSites).toHaveLength(15);
      expect(expectedSearchSites).toHaveLength(10);

      const albumEntry = [...byDescription.entries()].find(([d]) => d.startsWith('Album deep link'));
      const searchEntry = [...byDescription.entries()].find(([d]) => d.startsWith('Search URL'));
      expect(albumEntry, 'album note class').toBeDefined();
      expect(searchEntry, 'search note class').toBeDefined();
      expect(albumEntry![1].sort()).toEqual(expectedAlbumSites.sort());
      expect(searchEntry![1].sort()).toEqual(expectedSearchSites.sort());

      // The two notes are the same enforcement paragraph with different lead
      // sentences and only the bandcamp clause differing at the tail — that
      // is the whole reason a second anchor was cheaper than losing the
      // album/search distinction.
      const shared = 'Contract-level `format: uri` only.';
      const albumBody = albumEntry![0].slice(albumEntry![0].indexOf(shared));
      const searchBody = searchEntry![0].slice(searchEntry![0].indexOf(shared));
      // The `>` folded scalars each resolve with a trailing newline, so trim
      // before comparing the two stems.
      const albumStem = albumBody.split(' -- `bandcamp_url` is not host-checked')[0]!.trim();
      const searchStem = searchBody.trim().replace(/\.$/, '');
      expect(albumStem).toBe(searchStem);
    });
  });

  describe('Streaming Check (LML#376 partial-error semantics)', () => {
    it('should define StreamingCheckResponse.errored_sources as an optional string[]', () => {
      const schema = spec.components.schemas.StreamingCheckResponse as {
        properties: Record<string, { type?: string; items?: { type?: string } }>;
        required?: string[];
      };
      expect(schema.properties.errored_sources).toBeDefined();
      expect(schema.properties.errored_sources!.type).toBe('array');
      expect(schema.properties.errored_sources!.items?.type).toBe('string');
      // Not required — preserves backward compat for clients pinned to the
      // pre-1.8.0 schema. LML always emits it (defaulting to []); strict-
      // validating consumers should treat absence as [].
      expect(schema.required ?? []).not.toContain('errored_sources');
    });
  });

  describe('Artist Search Alias Schemas (artist-search-alias plan)', () => {
    it('should define ArtistSearchAliasSource as an open enum with the v1 sources', () => {
      const schema = spec.components.schemas.ArtistSearchAliasSource as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual([
        'discogs_name_variation',
        'discogs_alias',
        'discogs_member',
        'wxyc_library_alt',
      ]);
    });

    it('should define ArtistSearchAliasMethod enum', () => {
      const schema = spec.components.schemas.ArtistSearchAliasMethod as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual(['name_variation', 'alias', 'member', 'alt_curated']);
    });

    it('should define ArtistSearchAliasVariant requiring source + variant + method + confidence', () => {
      const schema = spec.components.schemas.ArtistSearchAliasVariant as {
        type: string;
        required: string[];
        properties: Record<string, { $ref?: string; type?: string; nullable?: boolean; minimum?: number; maximum?: number }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['source', 'variant', 'method', 'confidence']);
      expect(schema.properties.source!.$ref).toBe('#/components/schemas/ArtistSearchAliasSource');
      expect(schema.properties.method!.$ref).toBe('#/components/schemas/ArtistSearchAliasMethod');
      expect(schema.properties.variant!.type).toBe('string');
      // related_external_id / related_name / active are nullable optionals — only set for some kinds.
      expect(schema.properties.related_external_id!.nullable).toBe(true);
      expect(schema.properties.related_name!.nullable).toBe(true);
      expect(schema.properties.active!.nullable).toBe(true);
      // Confidence in [0, 1].
      expect(schema.properties.confidence!.type).toBe('number');
      expect(schema.properties.confidence!.minimum).toBe(0);
      expect(schema.properties.confidence!.maximum).toBe(1);
    });

    it('should define ArtistSearchAliasesResult requiring name + variants + sources_present', () => {
      const schema = spec.components.schemas.ArtistSearchAliasesResult as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string } }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['name', 'variants', 'sources_present']);
      expect(schema.properties.variants!.type).toBe('array');
      expect(schema.properties.variants!.items?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasVariant',
      );
      // sources_present is the reconcile-scope tag list. Empty array means
      // "no leg ran" — BS leaves cached rows alone.
      expect(schema.properties.sources_present!.type).toBe('array');
      expect(schema.properties.sources_present!.items?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasSource',
      );
    });

    it('should define ArtistSearchAliasesBulkRequest requiring names with min/max bounds', () => {
      const schema = spec.components.schemas.ArtistSearchAliasesBulkRequest as {
        required: string[];
        properties: Record<string, { type?: string; minItems?: number; maxItems?: number; items?: { type?: string } }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['names']);
      expect(schema.properties.names!.type).toBe('array');
      expect(schema.properties.names!.minItems).toBe(1);
      expect(schema.properties.names!.maxItems).toBe(1000);
      expect(schema.properties.names!.items?.type).toBe('string');
    });

    it('should define ArtistSearchAliasesBulkResponse requiring artists + missing', () => {
      const schema = spec.components.schemas.ArtistSearchAliasesBulkResponse as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string; type?: string }; $ref?: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['artists', 'missing']);
      expect(schema.properties.artists!.type).toBe('array');
      expect(schema.properties.artists!.items?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasesResult',
      );
      expect(schema.properties.missing!.type).toBe('array');
      expect(schema.properties.missing!.items?.type).toBe('string');
      // cache_stats is optional — mirrors the LML lookup family convention.
      expect(schema.properties.cache_stats!.$ref).toBe('#/components/schemas/CacheStats');
      expect(schema.required).not.toContain('cache_stats');
    });

    it('should define ArtistMatchHint as a sibling to TrackMatchHint', () => {
      const schema = spec.components.schemas.ArtistMatchHint as {
        type: string;
        required: string[];
        properties: Record<string, { type?: string; $ref?: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['matched_variant', 'source']);
      expect(schema.properties.matched_variant!.type).toBe('string');
      expect(schema.properties.source!.$ref).toBe('#/components/schemas/ArtistSearchAliasSource');
    });

    it('should attach optional matched_via_alias to AlbumSearchResult, LookupResultItem, and LibrarySearchItem', () => {
      // Mirrors `matched_via?: TrackMatchHint[]` placement — every shape
      // that surfaces track-match provenance gets the alias-match sibling.
      // BS's catalog search composes alias hits (PR 5); LML's response
      // shapes carry the field forward-compatibly for the day LML composes
      // alias hits itself.
      const carriers = ['AlbumSearchResult', 'LookupResultItem', 'LibrarySearchItem'] as const;
      for (const name of carriers) {
        const schema = spec.components.schemas[name] as {
          properties: Record<string, { type?: string; items?: { $ref?: string } }>;
          required?: string[];
        };
        expect(schema, `${name} should exist`).toBeDefined();
        expect(schema.properties.matched_via_alias, `${name}.matched_via_alias`).toBeDefined();
        expect(schema.properties.matched_via_alias!.type).toBe('array');
        expect(schema.properties.matched_via_alias!.items?.$ref).toBe(
          '#/components/schemas/ArtistMatchHint',
        );
        expect(schema.required ?? []).not.toContain('matched_via_alias');
      }
    });

    it('should define POST /api/v1/artists/search-aliases/bulk under LMLBearerAuth', () => {
      const path = spec.paths['/api/v1/artists/search-aliases/bulk'] as {
        post?: {
          security?: Array<Record<string, unknown[]>>;
          requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };
      expect(path).toBeDefined();
      expect(path.post).toBeDefined();
      expect(path.post!.security).toEqual([{ LMLBearerAuth: [] }]);
      expect(path.post!.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasesBulkRequest',
      );
      expect(path.post!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasesBulkResponse',
      );
      // 401 / 413 contracts mirror bulk-resolve-libraries for consistency.
      expect(path.post!.responses?.['401']).toBeDefined();
      expect(path.post!.responses?.['413']).toBeDefined();
    });
  });

  describe('Bulk Artist Resolution Schemas (LML#759)', () => {
    it('should define ArtistResolveMethod with the two deciding tiers only', () => {
      // Cache legs never decide a resolution — they corroborate. The enum
      // therefore has exactly two values; cache evidence lives in
      // cache_corroboration instead.
      const schema = spec.components.schemas.ArtistResolveMethod as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual(['identity_store', 'api_search']);
    });

    it('should define ArtistResolveCacheLeg mirroring the reconciler cascade legs', () => {
      const schema = spec.components.schemas.ArtistResolveCacheLeg as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual([
        'cache_exact',
        'cache_member',
        'cache_alias',
        'cache_name_variation',
        'cache_trigram',
      ]);
    });

    it('should define ArtistResolveUnresolvedReason with a retryable escalation_unavailable', () => {
      // escalation_unavailable means "couldn't ask," not "asked and missed" —
      // consumers must not apply a no-match TTL to it (BS#1614's writer).
      const schema = spec.components.schemas.ArtistResolveUnresolvedReason as { enum?: string[] };
      expect(schema).toBeDefined();
      expect(schema.enum).toEqual(['not_found', 'ambiguous', 'escalation_unavailable']);
    });

    it('should define ArtistResolveResult requiring name + cache_corroboration', () => {
      const schema = spec.components.schemas.ArtistResolveResult as {
        type: string;
        required: string[];
        properties: Record<
          string,
          {
            type?: string;
            allOf?: Array<{ $ref?: string }>;
            nullable?: boolean;
            uniqueItems?: boolean;
            items?: { $ref?: string };
          }
        >;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['name', 'cache_corroboration']);
      expect(schema.properties.name!.type).toBe('string');
      // Verdict fields are optional: exactly one of discogs_artist_id
      // (resolved) or unresolved_reason (unresolved) appears per result.
      // method and unresolved_reason are allOf-wrapped so their presence
      // rules survive codegen ($ref sibling keys are dropped in 3.0).
      expect(schema.properties.discogs_artist_id!.type).toBe('integer');
      expect(schema.properties.canonical_name!.type).toBe('string');
      expect(schema.properties.method!.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/ArtistResolveMethod',
      );
      expect(schema.properties.unresolved_reason!.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/ArtistResolveUnresolvedReason',
      );
      // cache_corroboration is present on BOTH verdict kinds (per-leg yield
      // telemetry), so it is required — empty array when no leg matched. A
      // leg either yielded or didn't, so entries are unique (and adding
      // uniqueItems later would flip swift5 codegen Array→Set, a breaking
      // change that is free to avoid now).
      expect(schema.properties.cache_corroboration!.type).toBe('array');
      expect(schema.properties.cache_corroboration!.uniqueItems).toBe(true);
      expect(schema.properties.cache_corroboration!.items?.$ref).toBe(
        '#/components/schemas/ArtistResolveCacheLeg',
      );
      // candidate_count: always serialized per the description's wire pin;
      // null means "API tier did not run," never zero. Optional-in-schema
      // only because datamodel-codegen's default flags (LML's generator)
      // would type required+nullable as non-nullable int, rejecting null.
      expect(schema.properties.candidate_count!.type).toBe('integer');
      expect(schema.properties.candidate_count!.nullable).toBe(true);
    });

    it('should define ArtistResolveBulkRequest with the 25-name cap and optional dry_run', () => {
      const schema = spec.components.schemas.ArtistResolveBulkRequest as {
        required: string[];
        properties: Record<
          string,
          {
            type?: string;
            minItems?: number;
            maxItems?: number;
            items?: { type?: string; minLength?: number; maxLength?: number };
            default?: boolean;
          }
        >;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['names']);
      expect(schema.properties.names!.type).toBe('array');
      expect(schema.properties.names!.minItems).toBe(1);
      // 25, not 1000: a fully-escalating batch costs ~25 live Discogs API
      // calls (~30s at the shared 50/min budget); callers page.
      expect(schema.properties.names!.maxItems).toBe(25);
      // Per-item bounds: names feed live Discogs querystrings and verbatim
      // entity.identity mint keys, so empty and unbounded strings are
      // rejected at the contract.
      expect(schema.properties.names!.items?.type).toBe('string');
      expect(schema.properties.names!.items?.minLength).toBe(1);
      expect(schema.properties.names!.items?.maxLength).toBe(255);
      expect(schema.properties.dry_run!.type).toBe('boolean');
      expect(schema.properties.dry_run!.default).toBe(false);
    });

    it('should define ArtistResolveBulkResponse requiring index-aligned results', () => {
      const schema = spec.components.schemas.ArtistResolveBulkResponse as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string } }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['results']);
      expect(schema.properties.results!.type).toBe('array');
      expect(schema.properties.results!.items?.$ref).toBe(
        '#/components/schemas/ArtistResolveResult',
      );
    });

    it('should define POST /api/v1/artists/resolve/bulk under LMLBearerAuth', () => {
      const path = spec.paths['/api/v1/artists/resolve/bulk'] as {
        post?: {
          operationId?: string;
          security?: Array<Record<string, unknown[]>>;
          requestBody?: {
            required?: boolean;
            content?: Record<string, { schema?: { $ref?: string } }>;
          };
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };
      expect(path).toBeDefined();
      expect(path.post).toBeDefined();
      expect(path.post!.operationId).toBe('artistResolveBulk');
      expect(path.post!.security).toEqual([{ LMLBearerAuth: [] }]);
      expect(path.post!.requestBody?.required).toBe(true);
      expect(path.post!.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ArtistResolveBulkRequest',
      );
      expect(path.post!.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ArtistResolveBulkResponse',
      );
      // Full error contract: 400/401/413/422 mirror the sibling bulk
      // endpoints; 503 means the backing discogs-cache PG is unavailable
      // (Discogs saturation sheds per-name as escalation_unavailable,
      // never a batch 503). Every error status carries ApiErrorResponse.
      for (const status of ['400', '401', '413', '422', '503']) {
        expect(path.post!.responses?.[status]?.content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/ApiErrorResponse',
        );
      }
    });
  });

  describe('Bulk-Resolve-Libraries tracks gating + per-track identity (#297)', () => {
    type Schema = {
      type?: string;
      required?: string[];
      description?: string;
      properties?: Record<string, Record<string, unknown>>;
      example?: Record<string, unknown>;
    };

    // --- Option (B): opt-in `include_tracks`, gating BOTH kinds ---

    it('adds include_tracks to BulkResolveLibrariesRequest as an optional boolean', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesRequest as Schema;
      const flag = schema.properties?.include_tracks;
      expect(flag).toBeDefined();
      expect(flag!.type).toBe('boolean');
      expect(schema.required ?? []).not.toContain('include_tracks');
    });

    // Omission from `required` is necessary but NOT sufficient for the generated
    // TypeScript to treat the field as optional. openapi-typescript emits any
    // property carrying a `default` as non-optional regardless of `required`
    // (its `defaultNonNullable` option, on by default), on the reasoning that a
    // server fills the default in — sound for a response, wrong for a request
    // body the client constructs. With `default: false` present the published
    // `BulkResolveLibrariesRequest` generated as `include_tracks: boolean` with
    // no `?`, so `{ inputs }` failed to compile for every TS consumer — for the
    // one field whose contract is "omitted is the default, and what an
    // un-upgraded caller sends". The default lives in prose instead; assert on
    // the spec here, and on the emitted `.d.ts` in the codegen test below.
    it('does not give include_tracks a schema-level default', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesRequest as Schema;
      expect(schema.properties?.include_tracks).not.toHaveProperty('default');
    });

    it('documents in prose that omitting include_tracks means false', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesRequest as Schema;
      const description = (schema.properties?.include_tracks?.description as string) ?? '';
      expect(description).toMatch(/omitted/i);
      expect(description).toMatch(/default/i);
    });

    it('documents include_tracks as gating tracks on both single_artist and compilation', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesRequest as Schema;
      const description = (schema.properties?.include_tracks?.description as string) ?? '';
      expect(description).toMatch(/single_artist/);
      expect(description).toMatch(/compilation/);
    });

    // --- The id-space bridge (LML#1021 F2): BulkResolveInput.legacy_release_id ---
    // Backend's serial `library.id` and library.db's legacy MySQL
    // LIBRARY_RELEASE_ID are unrelated id spaces; LML's per-track store is
    // keyed by the latter, so without this field a per-track read cannot
    // join at all. Decision trail: WXYC/library-metadata-lookup#1021 and
    // WXYC/Backend-Service#1991.

    it('adds legacy_release_id to BulkResolveInput as an optional nullable integer', () => {
      const schema = spec.components.schemas.BulkResolveInput as Schema;
      const field = schema.properties?.legacy_release_id;
      expect(field).toBeDefined();
      expect(field!.type).toBe('integer');
      expect(field!.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('legacy_release_id');
    });

    // Same openapi-typescript `defaultNonNullable` trap as include_tracks: a
    // schema-level default would emit the TS property non-optional despite
    // its absence from `required`, forcing every caller to pass it.
    it('does not give legacy_release_id a schema-level default', () => {
      const schema = spec.components.schemas.BulkResolveInput as Schema;
      expect(schema.properties?.legacy_release_id).not.toHaveProperty('default');
    });

    it('documents legacy_release_id as the legacy LIBRARY_RELEASE_ID space, distinct from the serial library_id', () => {
      const schema = spec.components.schemas.BulkResolveInput as Schema;
      const description = (schema.properties?.legacy_release_id?.description as string) ?? '';
      expect(description).toMatch(/LIBRARY_RELEASE_ID/);
      expect(description).toMatch(/library\.db/);
      expect(description).toMatch(/serial/);
    });

    it('documents the bridge-absent degradation: not-yet-visited, keep re-asking', () => {
      const schema = spec.components.schemas.BulkResolveInput as Schema;
      const description = (schema.properties?.legacy_release_id?.description as string) ?? '';
      expect(description).toMatch(/tracks_attempted/);
      expect(description).toMatch(/absent or NULL/i);
    });

    it('replaces the two-state tracks wording with the four states, on both kinds', () => {
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const tracks = schema.properties?.tracks;
      expect(tracks).toBeDefined();
      const description = (tracks!.description as string) ?? '';
      // The superseded contract: V/A-only, and exactly two states.
      expect(description).not.toMatch(/Two states/i);
      expect(description).not.toMatch(/Set only for `kind: compilation`/);
      // Nor the three-state framing that shipped in this PR's first pass — the
      // empty array turned out to carry two meanings, so `tracks` alone cannot
      // name the state; it names it jointly with `tracks_attempted`.
      expect(description).not.toMatch(/Three states/i);
      // The four states this ticket settled.
      expect(description).toMatch(/absent/i);
      expect(description).toMatch(/empty/i);
      expect(description).toMatch(/include_tracks/);
      expect(description).toMatch(/single_artist/);
      // Still optional — the absent state is what an un-upgraded caller sees.
      expect(schema.required ?? []).not.toContain('tracks');
    });

    it('declares tracks nullable, because LML spells the absent state `"tracks": null`', () => {
      // LML builds every non-track result with `tracks=None` and serves the
      // endpoint through FastAPI's `response_model` with no
      // `response_model_exclude_none`, so the wire has always carried an
      // explicit null. Optional-but-not-nullable would generate a TS type
      // (`tracks?: T[]`) that every live response already violates.
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      expect(schema.properties?.tracks?.nullable).toBe(true);
      const description = (schema.properties?.tracks?.description as string) ?? '';
      expect(description).toMatch(/NULL/);
    });

    it('corrects BulkResolveResultKind so compilation no longer owns tracks alone', () => {
      const kind = spec.components.schemas.BulkResolveResultKind as Schema;
      const description = kind.description ?? '';
      expect(description).toMatch(/include_tracks/);
      expect(kind).toHaveProperty('enum', ['single_artist', 'compilation', 'unresolved']);
    });

    // --- `tracks_attempted`: the resolved signal, decoupled from array length ---
    //
    // Without it, `tracks: []` carries two meanings that a consumer cannot tell
    // apart: the matcher has not visited this row, and the matcher ran and
    // resolved nothing. Extending the gate to `kind: single_artist` makes the
    // second case ordinary rather than theoretical — a release LML holds no
    // tracklist for. BS#1991 would read every one of them as "not yet visited"
    // and re-ask forever, which is the pathology `kind: unresolved` was made a
    // first-class outcome to prevent, reintroduced one grain down.

    it('adds tracks_attempted to BulkResolveResult as an optional nullable boolean', () => {
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const attempted = schema.properties?.tracks_attempted;
      expect(attempted).toBeDefined();
      expect(attempted!.type).toBe('boolean');
      // Optional + nullable, symmetric with `tracks`: an un-upgraded caller that
      // never sends include_tracks keeps today's payload, and LML spells every
      // not-asked field `null` rather than omitting the key.
      expect(attempted!.nullable).toBe(true);
      expect(schema.required ?? []).not.toContain('tracks_attempted');
    });

    it('makes tracks_attempted the resolved signal, decoupled from array length', () => {
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const description = (schema.properties?.tracks_attempted?.description as string) ?? '';
      // The load-bearing sentence: true once the matcher has visited the row,
      // however many tracks it resolved — including none.
      expect(description).toMatch(/regardless of how many/i);
      expect(description).toMatch(/WXYC\/Backend-Service#1991/);
      // And the pairing has to be spelled out, or a producer can emit the one
      // combination that means nothing (`false` alongside a populated array).
      expect(description).toMatch(/`false`[\s\S]*empty/);
    });

    it('retires "non-empty is the resolved signal" from the tracks description', () => {
      // The 2026-08-06 settlement read non-empty as resolved. That heuristic is
      // superseded by the explicit flag; leaving it in the prose would give
      // consumers two rules that disagree exactly on the zero-track case.
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const description = (schema.properties?.tracks?.description as string) ?? '';
      expect(description).not.toMatch(/non-empty as a resolved signal/);
      expect(description).toMatch(/tracks_attempted/);
    });

    // --- #303 Q2: the forbidden (false, populated tracks) pairing gets a
    // defined consumer reading instead of staying merely prohibited ---
    //
    // The schema cannot enforce that a producer never emits `false` alongside
    // a populated `tracks` — both are independent optional properties, no
    // oneOf/dependentRequired. Mitigation (2) from #303: keep the "producers
    // must not emit it" prohibition, and additionally define what a consumer
    // does if a producer bug emits it anyway, so the violation is survivable
    // rather than undefined behavior on the pairing that gates a retry loop.

    it('keeps the existing "producers must not emit it" prohibition on tracks_attempted', () => {
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const description = (schema.properties?.tracks_attempted?.description as string) ?? '';
      expect(description).toMatch(/producers must not emit it/);
    });

    it('adds the #303 Q2 consumer reading: false alongside populated tracks MUST be read as true', () => {
      const schema = spec.components.schemas.BulkResolveResult as Schema;
      const description = (schema.properties?.tracks_attempted?.description as string) ?? '';
      expect(description).toMatch(
        /observes `tracks_attempted: false`[\s\S]*MUST read it as `true`/,
      );
      expect(description).toMatch(/wxyc-shared#303/);
    });

    // --- #303 Q1 option A: tracks_contract_version, the producer-echoed
    // capability marker ---
    //
    // Follows the precedent already in this spec: LookupResponse.api_version
    // answers LookupRequest.include_identity the same way. Without a marker,
    // (absent, absent) on `tracks_attempted`/`tracks` is one wire spelling for
    // two different facts during the LML rollout window — "the producer
    // understood include_tracks and genuinely has nothing to report" and "the
    // producer predates include_tracks entirely" — and a consumer cannot tell
    // them apart. `tracks_contract_version` is the positive signal that closes
    // the gap.

    it('adds tracks_contract_version to BulkResolveLibrariesResponse as an optional integer pinned to 1', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const marker = schema.properties?.tracks_contract_version;
      expect(marker).toBeDefined();
      expect(marker!.type).toBe('integer');
      expect(marker!.enum).toEqual([1]);
      // Optional and additive — an old producer that never heard of this
      // field simply omits it, which is exactly the state the marker exists
      // to name.
      expect(schema.required ?? []).not.toContain('tracks_contract_version');
    });

    // A property carrying an OpenAPI `default` is emitted non-optional by
    // openapi-typescript regardless of `required` (its `defaultNonNullable`
    // option). `include_tracks` was bitten by exactly this; the marker's
    // whole job is to be distinguishably absent, so a default would defeat it.
    it('does not give tracks_contract_version a schema-level default', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      expect(schema.properties?.tracks_contract_version).not.toHaveProperty('default');
    });

    it('documents tracks_contract_version as present only when the producer understood include_tracks', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const description = (schema.properties?.tracks_contract_version?.description as string) ?? '';
      expect(description).toMatch(/present and equal to 1/i);
      expect(description).toMatch(/include_tracks/);
      expect(description).toMatch(/absent/i);
    });

    it('ties tracks_contract_version to the api_version / include_identity precedent this spec already set', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const description = (schema.properties?.tracks_contract_version?.description as string) ?? '';
      expect(description).toMatch(/api_version/);
    });

    it('mentions tracks_contract_version in the four-state block comment, so a reader of the table learns how to tell an old producer from a new one', () => {
      const commentBlock = specText.slice(
        specText.indexOf('# Four states, read off the PAIR'),
        specText.indexOf('BulkResolveLibrariesRequest:'),
      );
      expect(commentBlock).toMatch(/tracks_contract_version/);
    });

    it('mentions tracks_contract_version in the bulk-resolve-libraries endpoint description', () => {
      const opBlock = specText.slice(
        specText.indexOf('/api/v1/identity/bulk-resolve-libraries:'),
        specText.indexOf('/api/v1/artists/search-aliases/bulk:'),
      );
      expect(opBlock).toMatch(/tracks_contract_version/);
    });

    // The `tracks_contract_version.description` states the marker's full
    // precondition: present only when the request set `include_tracks: true`
    // AND the producer understood it; absent otherwise, and "otherwise"
    // explicitly includes the ordinary `include_tracks: false`-or-omitted
    // request from a fully-upgraded producer, not only the predates-the-flag
    // case. A reader who works only from the four-state block comment or the
    // endpoint description — not the property description three schemas
    // away — has to learn the same precondition, or an ordinary
    // `include_tracks: false` call reads as "this producer predates the
    // flag" against a fully-upgraded LML.

    it('states the include_tracks: true precondition for tracks_contract_version in the four-state block comment, not just that the marker exists', () => {
      const commentBlock = specText.slice(
        specText.indexOf('# Four states, read off the PAIR'),
        specText.indexOf('BulkResolveLibrariesRequest:'),
      );
      expect(commentBlock).toMatch(/include_tracks: true/);
      expect(commentBlock).toMatch(/false or omitted/i);
    });

    it('states the include_tracks: true precondition for tracks_contract_version in the bulk-resolve-libraries endpoint description too', () => {
      const opBlock = specText.slice(
        specText.indexOf('/api/v1/identity/bulk-resolve-libraries:'),
        specText.indexOf('/api/v1/artists/search-aliases/bulk:'),
      );
      expect(opBlock).toMatch(/include_tracks: true/);
      expect(opBlock).toMatch(/false or omitted/i);
    });

    // The Q2 MUST rule (`tracks_attempted: false` + populated `tracks` reads
    // as `true`) was added only to the tracks_attempted property description
    // in this PR's first pass. The four-state block comment is the canonical
    // table an implementer works from ("Four states, read off the PAIR"), and
    // the endpoint description is the other prose surface a Backend-Service
    // implementer reads before ever opening the schema — both need the same
    // repaired reading, or an implementer working from either one reproduces
    // the un-repaired retry loop the mitigation exists to make survivable.

    it('adds the #303 Q2 consumer reading to the four-state block comment', () => {
      const commentBlock = specText.slice(
        specText.indexOf('# Four states, read off the PAIR'),
        specText.indexOf('BulkResolveLibrariesRequest:'),
      );
      expect(commentBlock).toMatch(/producers must not emit it/);
      expect(commentBlock).toMatch(/MUST read it as `true`/);
    });

    it('adds the #303 Q2 consumer reading to the bulk-resolve-libraries endpoint description', () => {
      const opBlock = specText.slice(
        specText.indexOf('/api/v1/identity/bulk-resolve-libraries:'),
        specText.indexOf('/api/v1/artists/search-aliases/bulk:'),
      );
      expect(opBlock).toMatch(/MUST read it as `true`/);
    });

    // --- #310: tracks_contract_version ships `null` on every response, and
    // its presence-probe description was the exact inverse of a working
    // check ---
    //
    // LML serves this endpoint through FastAPI's `response_model` without
    // `response_model_exclude_none` and never sets the marker, so the wire
    // carries `"tracks_contract_version": null` on 100% of bulk-resolve
    // responses today — including from a producer that does not implement
    // `include_tracks` at all. `null` is not a valid instance of
    // `enum: [1]`, so the field needs the same `nullable: true` treatment
    // its siblings `tracks` / `tracks_attempted` already carry. And because
    // it is always null in practice, a presence probe reads TRUE against
    // exactly the producer that predates the flag — the inverse of the
    // marker's purpose — so the description has to mandate a
    // value-equality check instead.

    it('declares tracks_contract_version nullable, because LML ships `"tracks_contract_version": null` on every response today', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      expect(schema.properties?.tracks_contract_version?.nullable).toBe(true);
    });

    it('keeps tracks_contract_version out of required after the nullable fix', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      expect(schema.required ?? []).not.toContain('tracks_contract_version');
    });

    it('mandates a value-equality check on tracks_contract_version and forbids a presence check', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const description = (schema.properties?.tracks_contract_version?.description as string) ?? '';
      expect(description).toMatch(/MUST test for the value `1`/);
      expect(description).toMatch(/must never test for key presence/);
    });

    it('explains why the value probe is required: absent, null, and a pre-#310 producer must all read "not supported"', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const description = (schema.properties?.tracks_contract_version?.description as string) ?? '';
      expect(description).toMatch(/not supported/);
      expect(description).toMatch(/only the literal value `1` reads "supported"/);
    });

    it('states the partial-rollout producer rule: the marker requires tracks_attempted on both single_artist and compilation', () => {
      const schema = spec.components.schemas.BulkResolveLibrariesResponse as Schema;
      const description = (schema.properties?.tracks_contract_version?.description as string) ?? '';
      expect(description).toMatch(/`kind: single_artist`/);
      expect(description).toMatch(/`kind: compilation`/);
      expect(description).toMatch(/LML#1021/);
      expect(description).toMatch(/LML#1138/);
    });

    it('carries the value-probe rule in the four-state block comment, not just the property description', () => {
      const commentBlock = specText.slice(
        specText.indexOf('# Four states, read off the PAIR'),
        specText.indexOf('BulkResolveLibrariesRequest:'),
      );
      expect(commentBlock).toMatch(/MUST test for the value `1`/);
      expect(commentBlock).toMatch(/must never test for key presence/);
    });

    it('carries the value-probe rule in the bulk-resolve-libraries endpoint description too', () => {
      const opBlock = specText.slice(
        specText.indexOf('/api/v1/identity/bulk-resolve-libraries:'),
        specText.indexOf('/api/v1/artists/search-aliases/bulk:'),
      );
      expect(opBlock).toMatch(/MUST test for the value `1`/);
      expect(opBlock).toMatch(/must never test for key presence/);
    });

    it('carries the partial-rollout producer rule (LML#1138 alongside LML#1021) in the four-state block comment', () => {
      const commentBlock = specText.slice(
        specText.indexOf('# Four states, read off the PAIR'),
        specText.indexOf('BulkResolveLibrariesRequest:'),
      );
      expect(commentBlock).toMatch(/LML#1138/);
      expect(commentBlock).toMatch(/LML#1021/);
    });

    it('carries the partial-rollout producer rule (LML#1138 alongside LML#1021) in the bulk-resolve-libraries endpoint description', () => {
      const opBlock = specText.slice(
        specText.indexOf('/api/v1/identity/bulk-resolve-libraries:'),
        specText.indexOf('/api/v1/artists/search-aliases/bulk:'),
      );
      expect(opBlock).toMatch(/LML#1138/);
      expect(opBlock).toMatch(/LML#1021/);
    });

    // --- BulkResolveTrackIdentity repair (BS#1991 / LML#1021) ---

    it('ships the join-back echoes, composed verdict, and canonical artist on BulkResolveTrackIdentity', () => {
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        [
          'artist_name',
          'confidence',
          'method',
          'resolved_artist_name',
          'sources',
          'track_position',
          'track_title',
        ].sort(),
      );

      // artist_name is the join-back key BS actually has (78% of CTA rows are
      // position-NULL per BS#1989), so it is required and non-nullable — and
      // minLength 1, since an empty join key is no more usable than a missing
      // one (same guard CatalogCompilationTrackRow.artist_name carries over
      // the physical column). No maxLength: the single_artist arm echoes a
      // source credit no WXYC column bounds, so a cap would decode-fail rather
      // than protect.
      expect(schema.properties?.artist_name?.type).toBe('string');
      expect(schema.properties?.artist_name?.nullable).toBeUndefined();
      expect(schema.properties?.artist_name?.minLength).toBe(1);
      expect(schema.properties?.artist_name?.maxLength).toBeUndefined();
      expect(schema.required ?? []).toContain('artist_name');

      // track_title completes the join key; nullable because the CTA column is.
      expect(schema.properties?.track_title?.type).toBe('string');
      expect(schema.properties?.track_title?.nullable).toBe(true);
    });

    it('makes track_position nullable but keeps the key present (positions are unrecoverable for some V/A rows)', () => {
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const position = schema.properties?.track_position;
      expect(position?.type).toBe('string');
      expect(position?.nullable).toBe(true);
      // Required-but-nullable: the null says "no position for this row",
      // which an absent key could not distinguish from "not echoed".
      expect(schema.required ?? []).toContain('track_position');
    });

    it('lands the composed per-track verdict as required-but-nullable resolved_artist_name / confidence / method', () => {
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const required = schema.required ?? [];

      const resolved = schema.properties?.resolved_artist_name;
      expect(resolved?.type).toBe('string');
      expect(resolved?.nullable).toBe(true);
      expect(required).toContain('resolved_artist_name');

      const confidence = schema.properties?.confidence;
      expect(confidence?.type).toBe('number');
      expect(confidence?.nullable).toBe(true);
      expect(confidence?.minimum).toBe(0);
      expect(confidence?.maximum).toBe(1);
      expect(required).toContain('confidence');

      // method is a nullable $ref, so it has to be wrapped in allOf.
      const method = schema.properties?.method as { allOf?: Array<{ $ref?: string }>; nullable?: boolean };
      expect(method?.allOf?.[0]?.$ref).toBe('#/components/schemas/IdentityMethod');
      expect(method?.nullable).toBe(true);
      expect(required).toContain('method');
    });

    it('documents artist_name and track_title as dual-mode (CTA echo for V/A, source credit for non-V/A)', () => {
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      for (const key of ['artist_name', 'track_title']) {
        const description = (schema.properties?.[key]?.description as string) ?? '';
        expect(description, key).toMatch(/compilation/);
        expect(description, key).toMatch(/single_artist/);
      }
    });

    it('states the null-resolved_artist_name convention so non-empty tracks reads as attempted', () => {
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const description = (schema.properties?.resolved_artist_name?.description as string) ?? '';
      // Same "the leg ran" convention as BulkResolveProvenanceEntry.external_id:
      // the null must be tied to the matcher having run and resolved nothing,
      // not merely mentioned somewhere in the prose.
      expect(description).toMatch(/NULL when the matcher visited this track/);
      expect(description).toMatch(/`confidence`[\s\S]*`method` are NULL/);
    });

    it('keeps `sources` from claiming the verdict that now lives on resolved_artist_name', () => {
      // `sources: []` (no leg produced a row) and a populated `sources` whose
      // entries carry NULL external_id (legs ran, no candidate) are different
      // statements that both accompany a NULL verdict. Before this ticket the
      // field's own description said an empty array meant "found no matches",
      // which collided with the new convention and gave a producer two ways to
      // encode one state.
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const description = (schema.properties?.sources?.description as string) ?? '';
      expect(description).not.toMatch(/found no matches/);
      expect(description).toMatch(/resolved_artist_name/);
    });

    it('drops the storage instruction naming a table that was never built (BS#801)', () => {
      // 1.29.0 told Backend to write per-source rows verbatim into a
      // `library_track_identity_source` sidecar. It does not exist — BS#792,
      // the Backend-side design ticket that would have created it, closed as
      // a design decision and the schema half never happened (verified
      // against prod and all 136 migrations in BS#801). LML's per-track
      // store is the per-source system of record and Backend persists
      // composed verdicts only, so the contract must not send a consumer off
      // to build the sidecar.
      // The table name still appears, but only inside its own retraction —
      // a reader migrating off 1.29.0 needs to be told the sidecar isn't
      // coming, not left to infer it from silence.
      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const description = schema.description ?? '';
      // Pin the retraction, not one phrasing of the instruction: any sentence
      // naming the table has to be the one saying it was never built.
      expect(description).toMatch(/library_track_identity_source[^.]*never built/);
      expect(description).toMatch(/composed verdict/i);
      // Assert what the retraction is for — that no sentence reintroduces the
      // table as a live storage instruction — rather than that exactly one
      // sentence mentions it. Pinning the count made a correct spec go red for
      // adding a second, also-correct sentence (e.g. a migration note), and the
      // failure surfaced as an opaque length mismatch.
      const sentencesNamingTheTable = description
        .split(/(?<=\.)\s+/)
        .filter((s) => s.includes('library_track_identity_source'));
      expect(sentencesNamingTheTable.length).toBeGreaterThan(0);
      for (const sentence of sentencesNamingTheTable) {
        expect(sentence).toMatch(/never built|not built|no such table/i);
      }
    });

    it('never states that LML#271 is closed — it is open, and BS#792 is the ticket that closed', () => {
      // 1.29.0 cited WXYC/library-metadata-lookup#271 as the design behind the
      // `library_track_identity_source` sidecar, and the retraction that
      // replaced it carried that citation forward as "#271 closed as a design
      // decision". #271 is OPEN: it is LML's own per-track identity work,
      // still being implemented under LML#1021. The ticket that closed as a
      // design decision without ever growing its schema half is
      // WXYC/Backend-Service#792 — which is what the cited BS#801 comment
      // actually says.
      //
      // Pin the fact (no clause anywhere asserts #271 closed), not a phrasing.
      // The description is free to cite #271 accurately, or to leave it out
      // entirely; either passes.
      //
      // Scope is the whole spec text, not one schema's description. The false
      // attribution is copy-paste-shaped — the same feature is discussed in
      // BulkResolveResult, BulkResolveProvenanceEntry and the operation
      // description, all of which already cite LML#1021 — and a guard that
      // reads one schema would watch it reappear anywhere else in silence.
      //
      // Proximity is measured in words rather than with a `[^.;]*` clause
      // bound. This description is saturated with periods that are not
      // sentence ends (`1.29.0`, `https://github.com/...`), so a dot-excluding
      // bound stops early and misses exactly the citation-carried-forward
      // wording that caused the defect — e.g. "#271 (as of `1.29.0`) closed as
      // a design decision".
      const nearbyClosure = /library-metadata-lookup#271(?:\W+\w+){0,12}\W+\bclos(?:e|ed|es|ing|ure)\b/i;
      const nearbyClosureBefore = /\bclos(?:e|ed|es|ing|ure)\b(?:\W+\w+){0,12}\W+library-metadata-lookup#271/i;
      expect(specText).not.toMatch(nearbyClosure);
      expect(specText).not.toMatch(nearbyClosureBefore);

      const schema = spec.components.schemas.BulkResolveTrackIdentity as Schema;
      const description = schema.description ?? '';
      // The retraction's evidence has to survive the citation fix: the "never
      // built" claim rests entirely on the BS#801 comment that measured prod
      // and all 136 migrations. Losing the permalink would leave an
      // unsourced assertion about a table nobody can check.
      expect(description).toContain(
        'Backend-Service/issues/801#issuecomment-5187348795',
      );
      // And the positive half of the correction: the ticket that actually
      // closed as a design decision has to be named, or the withdrawn 1.29.0
      // instruction stops being traceable. Without this, deleting the BS#792
      // attribution and writing "the ticket that would have created it closed
      // as a design decision" passes every assertion above while losing the
      // fact the fix exists to record.
      expect(description).toMatch(/Backend-Service#792/);
    });

    // --- the four states have to be legible from the example, not just the prose ---

    const exampleResults = () =>
      ((spec.components.schemas.BulkResolveLibrariesResponse as Schema).example
        ?.results ?? []) as Array<Record<string, unknown>>;

    it('spells tracks and tracks_attempted as explicit nulls on the unresolved result', () => {
      // Both the response description and BulkResolveResult.tracks argue that
      // LML emits `"tracks": null` rather than omitting the key — that claim is
      // the justification for marking the field nullable and for one of the two
      // oasdiff whitelist entries. An example that models the state by omitting
      // the keys teaches LML#1021 the opposite of what the schema argues.
      const unresolved = exampleResults().find((r) => r.kind === 'unresolved');
      expect(unresolved).toBeDefined();
      expect(unresolved).toHaveProperty('tracks', null);
      expect(unresolved).toHaveProperty('tracks_attempted', null);
    });

    it('demonstrates all four tracks_attempted/tracks states', () => {
      const states = exampleResults()
        .filter((r) => r.kind !== 'unresolved')
        .map((r) => `${String(r.tracks_attempted)}/${Array.isArray(r.tracks) && r.tracks.length > 0 ? 'entries' : 'empty'}`);
      // (false, []) is the state the flag exists to disambiguate from (true, []);
      // an example that never shows it leaves the distinction abstract.
      expect(states).toContain('false/empty');
      expect(states).toContain('true/empty');
      expect(states).toContain('true/entries');
    });

    it('shows tracks_contract_version: 1 in the flag-on response example', () => {
      // The example is `include_tracks: true` throughout (per the response
      // description above), so it's the producer-understood-the-flag case —
      // the marker belongs on the example precisely because it is response-
      // level, not per-result.
      const example = (spec.components.schemas.BulkResolveLibrariesResponse as Schema).example;
      expect(example).toHaveProperty('tracks_contract_version', 1);
    });
  });

  // --- #372: an operation is declared where it is actually served ---
  //
  // api.yaml is a multi-service document carrying a single-service `servers:`
  // block — it declares https://api.wxyc.org and nothing else, while seven
  // operations are served by library-metadata-lookup on a different host. With
  // no per-operation marker saying which service owns a path, reachability is
  // not decidable from the document alone, and that is the root cause of the
  // defect class this block guards: seventeen operations were declared at paths
  // nothing served, and nothing in the repo could tell.
  //
  // `x-wxyc-service` is that marker. Generators ignore unknown `x-` keys, so it
  // carries no codegen risk in any of the five generating repos, and it makes
  // the audit re-runnable from the document instead of reconstructed by hand.
  //
  // The audit itself, for whoever re-runs it — read-only, needs no credentials:
  //
  //   curl -s -o /dev/null -w '%{http_code}\n' "https://api.wxyc.org<path>"
  //
  // 401/403 means the route is MOUNTED: auth rejected the caller before routing
  // could 404, so auth is the signal that the route exists, not an obstacle to
  // probing for it. 200/400/422 likewise means mounted. Only a 404 with an HTML
  // `Cannot GET` body means nothing is mounted there. Write methods are never
  // probed against production; they are diffed against Backend's static route
  // table instead — mount prefixes from `app.use('/x', x_route)` in
  // apps/backend/app.ts, sub-paths from `<router>.<verb>('<subpath>')` across
  // apps/backend/routes/*.ts, concatenated and compared to the declared set.
  describe('Service ownership and route reachability (#372)', () => {
    // The closed set. A third service earning operations in this document is a
    // decision, not a typo, so it costs a line here.
    const SERVICES = ['backend-service', 'library-metadata-lookup'] as const;

    // library-metadata-lookup's operations, pinned exhaustively rather than by
    // prefix. A prefix rule ("/api/v1/* is LML") would silently absorb a future
    // Backend operation that happened to be versioned, which is precisely the
    // kind of quiet drift the marker exists to stop.
    const LML_OPERATIONS = [
      'post /api/v1/artists/genres/bulk',
      'post /api/v1/artists/resolve/bulk',
      'post /api/v1/artists/search-aliases/bulk',
      'post /api/v1/cache/refresh-for-identities',
      'post /api/v1/identity/bulk-resolve-libraries',
      'post /api/v1/identity/resolve',
      'post /api/v1/lookup',
    ] as const;

    it('marks every operation with exactly one service from the closed set', () => {
      const offenders: string[] = [];
      for (const [method, path, operation] of operations()) {
        const service = operation['x-wxyc-service'];
        if (typeof service !== 'string') {
          offenders.push(`${method} ${path}: x-wxyc-service is ${JSON.stringify(service)}`);
          continue;
        }
        if (!(SERVICES as readonly string[]).includes(service)) {
          offenders.push(`${method} ${path}: unknown service "${service}"`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });

    // The converse of the prefix rule this deliberately does NOT use for
    // attribution: /api/v1/* is LML's mount, so nothing under it can be
    // Backend's. Without this a future LML operation mis-marked
    // `backend-service` passes every other guard here silently.
    it('never attributes an /api/v1 operation to backend-service', () => {
      const misattributed = operations()
        .filter(([, path]) => path.startsWith('/api/v1/'))
        .filter(([, , operation]) => operation['x-wxyc-service'] === 'backend-service')
        .map(([method, path]) => `${method} ${path}`);
      expect(misattributed, misattributed.join('\n')).toEqual([]);
    });

    it('attributes exactly the known seven operations to library-metadata-lookup', () => {
      const lml = operations()
        .filter(([, , op]) => op['x-wxyc-service'] === 'library-metadata-lookup')
        .map(([method, path]) => `${method} ${path}`)
        .sort();
      expect(lml).toEqual([...LML_OPERATIONS].sort());
    });

    // The seventeen. Set out as a closed list so the audit is re-runnable: a
    // re-declaration at any of these paths fails here and sends the author back
    // to the probe rather than to a 404 in a generated client.
    //
    // Six were real routes declared at the wrong path and were corrected, not
    // deleted (see the companion assertion below). Eleven were never built —
    // eight unbuilt features and three survivals of the Cognito era, whose
    // `cognito_user_name` query parameter names an auth system Backend has not
    // run for years.
    const UNREACHABLE_PATHS = [
      '/album-reviews',
      '/djs',
      '/djs/register',
      '/library/labels',
      '/library/tracks',
      '/lookup',
      '/metadata/album',
      '/metadata/artist',
      '/requests',
      '/requests/{id}',
      '/schedule/shifts',
      '/schedule/specialty',
      '/v2/flowsheet',
      '/v2/flowsheet/latest',
    ] as const;

    it('declares no path that production serves nothing at', () => {
      const redeclared = UNREACHABLE_PATHS.filter((p) => spec.paths[p] !== undefined);
      expect(
        redeclared,
        `re-declared phantom paths: ${redeclared.join(', ')} — re-run the probe before adding these back`
      ).toEqual([]);
    });

    // The other half of the same claim. Deleting a phantom is only correct when
    // the endpoint truly does not exist; where it does, the declaration moved to
    // the serving path, and asserting the destinations keeps a future cleanup
    // from "resolving" a phantom by deleting the corrected operation too.
    it('declares the corrected Class A paths at the route that serves them', () => {
      // GET+POST /labels (app.use('/labels', labels_route)), POST /request
      // (singular, requestLine.route.ts), POST /api/v1/lookup (LML mounts
      // lookup_router with prefix="/api/v1").
      expect(spec.paths['/labels']).toBeDefined();
      expect(spec.paths['/request']).toBeDefined();
      expect(spec.paths['/api/v1/lookup']).toBeDefined();
      // The two /metadata/* duplicates were deleted rather than moved: the
      // proxy path they should have named was already declared separately.
      expect(spec.paths['/proxy/metadata/album']).toBeDefined();
      expect(spec.paths['/proxy/metadata/artist']).toBeDefined();
    });

    it('records on GET /flowsheet that the V2 shape ships on the V1 path', () => {
      // Backend names `/v2/flowsheet` in three source comments and implements
      // `projectEntriesV2`, but calls it from `getEntries` — the handler mounted
      // at plain GET /flowsheet. The prefix was planned and never mounted, so
      // the only place a reader can learn where V2 lives is this description.
      const description = (spec.paths['/flowsheet'] as { get: { description?: string } }).get
        .description;
      expect(description).toBeDefined();
      expect(description).toMatch(/v2/i);
    });
  });

  describe('Security', () => {
    it('should define BearerAuth security scheme', () => {
      expect(spec.components.securitySchemes?.BearerAuth).toBeDefined();
    });

    // --- #372: a security requirement has to name a scheme that exists ---
    //
    // Both /library/labels operations declared `security: [{ bearerAuth: [] }]`
    // — lowercase `b`, against a components block that defines only `BearerAuth`
    // and `LMLBearerAuth`. openapi-generator resolves the name by exact match
    // and silently DROPS a requirement it cannot resolve, and generation runs
    // with --skip-validate-spec, so nothing anywhere errored. The generated
    // clients applied no auth at all to those two operations: the same failure
    // mode as an undeclared `security: []`, reached by a typo.
    //
    // Silent is the whole problem, so the guard is a walk rather than an
    // assertion about those two lines. It covers the document-level default and
    // every operation-level override, which is every place a scheme name can
    // appear.
    it('names only schemes that components.securitySchemes defines', () => {
      const defined = Object.keys(spec.components.securitySchemes ?? {});
      const unresolved: string[] = [];

      function check(where: string, security: unknown): void {
        if (!Array.isArray(security)) return;
        for (const requirement of security) {
          if (requirement === null || typeof requirement !== 'object') continue;
          for (const name of Object.keys(requirement as Record<string, unknown>)) {
            if (!defined.includes(name)) unresolved.push(`${where}: "${name}"`);
          }
        }
      }

      check('document default', (spec as { security?: unknown }).security);
      for (const [method, path, operation] of operations()) {
        check(`${method} ${path}`, (operation as { security?: unknown }).security);
      }

      expect(
        unresolved,
        `security requirements naming an undefined scheme (openapi-generator drops these silently, leaving the operation unauthenticated):\n  ${unresolved.join('\n  ')}\ndefined schemes: ${defined.join(', ')}`
      ).toEqual([]);
    });

    // --- #368: `security: []` is a claim about the route, and it has to be true ---
    //
    // The document-level `security: [{ BearerAuth: [] }]` is the default; an
    // operation-level `security: []` overrides it to mean "explicitly
    // unauthenticated". A generated client reads that literally and omits the
    // Authorization header, so an operation that declares it while Backend
    // serves it behind `requirePermissions({ <resource>: [...] })` promises a
    // 200 and delivers a 401 — which is exactly what `GET /library/info` and
    // `GET /library/formats` were doing.
    //
    // The guard below is a CLOSED allowlist rather than a per-operation
    // assertion on the two that were fixed. A test that only pinned those two
    // would go on passing while the next endpoint added behind
    // `requirePermissions` shipped declared-public; a closed list fails on any
    // *new* `security: []` and makes the author come here and write down why
    // the route is really public. Adding a line is cheap and deliberate,
    // which is the whole point.
    //
    // Auditable against production with no credentials — 401/403 means the
    // route is protected and `security: []` is wrong; 200 (or a 4xx from a
    // missing query param) means it is genuinely open:
    //
    //   curl -s -o /dev/null -w '%{http_code}\n' "https://api.wxyc.org<path>"
    //
    // Note that `requirePermissions({})` — verify the JWT, anonymous sessions
    // welcome — is a THIRD posture, and it is not `security: []` either. It
    // still requires a Bearer token, so it belongs under the global default.
    const PUBLIC_OPERATIONS: ReadonlyArray<readonly [string, string, string]> = [
      // [method, path, why it is genuinely public]
      ['get', '/auth/device', 'RFC 8628 status lookup — a session is optional by design: anonymous callers get the status, a signed-in DJ additionally claims the code for their account. Declared `security: [{}, { SessionBearerAuth: [] }]`, the other spelling of anonymously-callable, and pinned in that exact shape by the device-flow describe further down. The second member names SessionBearerAuth, not BearerAuth: the optional credential here is a better-auth SESSION token (the handler calls getSessionFromCtx), not a JWT'],
      ['post', '/auth/device/code', 'RFC 8628 device-code request — the whole point is that the device has no token yet'],
      ['post', '/auth/device/token', 'RFC 8628 token poll — same, this is where the token comes from'],
      ['get', '/concerts/{id}', 'deliberately public per BS#1694 / #236: the wxyc.org share Worker cannot mint anonymous sessions, and the response is publicly cacheable. Note the sibling GET /concerts is requirePermissions({}) and correctly does NOT appear here'],
      ['get', '/config', 'unauthenticated bootstrap config, by design (config.route.ts). /config/secrets is the authed half and is not listed here'],
      ['get', '/events/stream', 'browser EventSource cannot send an Authorization header; per-topic authz happens inside filterAuthorizedTopics (events.route.ts)'],
      ['get', '/flowsheet', 'no auth middleware on flowsheet_route.get("/")'],
      ['get', '/flowsheet/djs-on-air', 'no auth middleware'],
      ['get', '/flowsheet/latest', 'no auth middleware'],
      ['get', '/flowsheet/range', 'public date-windowed read, BS#2062 — the tubafrenzy /playlists/dailyEntries successor'],
      ['get', '/flowsheet/search', 'public playlist-archive search'],
      ['get', '/library/genres', 'deliberately public per BS#1682 — station-wide reference data, and dj-site#1004 SSR cannot attach a JWT. POST /library/genres stays catalog:write'],
      ['get', '/schedule', 'no auth middleware on schedule_route.get("/")'],
      ['post', '/auth/sign-in/email', 'better-auth sign-in route — the whole point is that the caller has no session yet'],
      ['post', '/auth/sign-in/username', 'better-auth sign-in route — same'],
      ['post', '/auth/sign-in/email-otp', 'better-auth OTP redemption — same; this is where a session is first created for the OTP flow'],
      ['post', '/auth/sign-in/anonymous', 'better-auth anonymous sign-in — same, by definition'],
      ['post', '/auth/email-otp/send-verification-otp', 'mails a one-time code to an unauthenticated caller; disableSignUp: true makes it answer identically for an unknown address (anti-enumeration)'],
      ['post', '/auth/wxyc/lookup-email', 'WXYC-custom OTP-flow leg 1 (apps/auth/app.ts lookupEmailHandler) — resolves a login identifier before any session exists. Rate-limited; see AuthPlainErrorResponse'],
    ] as const;

    // Seven lines left this list in #372, and none of them by being reviewed
    // and approved — six named paths nothing served and were deleted, and the
    // seventh was corrected. Worth recording, because "declared public" and
    // "phantom" were compounding: an operation that 404s cannot be audited by
    // the curl above (a phantom and a genuinely open route are both non-401),
    // so the placeholder reasons here were unfalsifiable by the very method
    // this list documents.
    //
    // Deleted with their paths: get /library/tracks, get /schedule/shifts,
    // get /schedule/specialty, get /v2/flowsheet, get /v2/flowsheet/latest.
    //
    // Corrected rather than deleted, and no longer public in either case:
    //   post /lookup    -> post /api/v1/lookup. LML mounts lookup_router with
    //     dependencies=[Depends(require_lml_key)], so it takes LMLBearerAuth
    //     like its six siblings. `security: []` understated it.
    //   post /requests  -> post /request. The handler is
    //     `request_line_route.post('/', requirePermissions({}), ...)`, which is
    //     the third posture named in the note above: a JWT is required,
    //     anonymous sessions are welcome. That is the global BearerAuth
    //     default, not `security: []`, so the override is simply gone.

    // Two spellings make an operation anonymously callable, and a guard that
    // knows only one is a guard with a door in the back. `security: []` is the
    // blunt override. `security: [{}, { SessionBearerAuth: [] }]` — a
    // requirement list with an empty-object member — says "no credential also
    // satisfies this", which is the same reachability with a different shape;
    // GET /auth/device uses it deliberately. Match both, or the next endpoint
    // written in the second style ships unreviewed past a green test. Note the
    // check is on the empty-object member alone and so is indifferent to WHICH
    // scheme the other members name — that is correct here, since the question
    // is reachability without a credential, not which credential an
    // authenticated caller would present.
    function isAnonymouslyCallable(security: unknown): boolean {
      if (!Array.isArray(security)) return false;
      if (security.length === 0) return true;
      return security.some((r) => r !== null && typeof r === 'object' && Object.keys(r).length === 0);
    }

    function declaredPublicOperations(): string[] {
      return operations()
        .filter(([, , operation]) =>
          isAnonymouslyCallable((operation as { security?: unknown }).security)
        )
        .map(([method, path]) => `${method} ${path}`)
        .sort();
    }

    it('gives every allowlisted operation a written reason', () => {
      // The third tuple element is the entire justification for an operation
      // being on this list, and nothing above reads it — the type demands a
      // string, not a non-empty one, so `''` would satisfy compiler and guard
      // alike and quietly vacate the point of the list.
      for (const [method, path, reason] of PUBLIC_OPERATIONS) {
        expect(reason.trim(), `${method} ${path}`).not.toBe('');
      }
    });

    it('declares no operation public beyond the reviewed allowlist', () => {
      const allowed = PUBLIC_OPERATIONS.map(([method, path]) => `${method} ${path}`).sort();
      // Set-equality, both directions: an unreviewed new `security: []` fails,
      // and so does an allowlist line whose operation has been corrected or
      // removed — so the reasons above can't rot into fiction.
      expect(declaredPublicOperations()).toEqual(allowed);
    });

    it('does not declare the catalog:read reads public — they 401 without a Bearer token', () => {
      // Both are `requirePermissions({ catalog: ['read'] })` in
      // apps/backend/routes/library.route.ts, and both return
      // `401 {"error":"Unauthorized: Missing Authorization header."}` in
      // production today. Backend's own app.yaml already had this right for
      // /library/info (it declares no operation-level security); this is
      // api.yaml catching up, not a new restriction on the wire.
      for (const route of ['/library/info', '/library/formats']) {
        const operation = (spec.paths[route] as { get?: { security?: unknown[] } })?.get;
        expect(operation, route).toBeDefined();
        // Inheriting the document default is the fix — an explicit
        // `security: [{ BearerAuth: [] }]` would be equivalent, so accept
        // either rather than pinning a formatting choice. Assert on the
        // requirement NAMES only: pinning the whole object would also pin the
        // scope list to empty, so a later, strictly more accurate
        // `security: [{ BearerAuth: ['catalog:read'] }]` — the scoped style
        // Backend's own app.yaml already uses on the /library/formats POST —
        // would fail a test whose stated job is to not care about shape.
        if (operation!.security !== undefined) {
          const names = (operation!.security as Array<Record<string, unknown>>).flatMap((r) => Object.keys(r));
          expect(names, route).toEqual(['BearerAuth']);
        }
      }
    });
  });

  describe('Healthcheck Schemas (wxyc-fastapi Phase C)', () => {
    it('should define HealthCheckResponse with required status enum and additionalProperties', () => {
      const schema = spec.components.schemas.HealthCheckResponse as {
        type: string;
        required: string[];
        properties: Record<string, { type?: string; enum?: string[] }>;
        additionalProperties?: boolean;
      };
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['status']);
      expect(schema.properties.status!.type).toBe('string');
      expect(schema.properties.status!.enum).toEqual(['healthy', 'degraded', 'unhealthy']);
      // Consumers may extend (e.g., semantic-index includes artist_count)
      expect(schema.additionalProperties).toBe(true);
    });

    it('should define ReadinessResponse extending HealthCheckResponse with required services map', () => {
      const schema = spec.components.schemas.ReadinessResponse as {
        allOf: Array<{
          $ref?: string;
          type?: string;
          required?: string[];
          properties?: Record<
            string,
            {
              type?: string;
              additionalProperties?: { type?: string; enum?: string[] };
            }
          >;
        }>;
      };
      expect(schema).toBeDefined();
      expect(Array.isArray(schema.allOf)).toBe(true);
      expect(schema.allOf).toHaveLength(2);

      const [base, extension] = schema.allOf;
      expect(base!.$ref).toBe('#/components/schemas/HealthCheckResponse');

      expect(extension!.type).toBe('object');
      expect(extension!.required).toEqual(['services']);
      const services = extension!.properties?.services;
      expect(services?.type).toBe('object');
      expect(services?.additionalProperties?.type).toBe('string');
    });

    // The value was a closed enum of `ok | unavailable | timeout`, and the
    // producer has never emitted two of those three. `checkDatabase()`
    // classifies into `ok | auth-error | rate-limited | upstream-error |
    // network-error | error`, a vocabulary chosen to match
    // library-metadata-lookup's `discogs_api` probe so the two can be
    // pattern-matched together -- so four of the five failure values were
    // enum violations on every 503 this endpoint has ever served, against a
    // strict generated decoder. `timeout` was not merely unused but
    // deliberately rejected upstream: Postgres has no timeout bucket distinct
    // from a lost connection, so a canceled statement reports
    // `network-error`.
    //
    // The same mistake as `Genre` and `Format` (see their note in api.yaml),
    // and from the same cause: a plausible-sounding set written down without a
    // call site. An open string is what a per-service map keyed by
    // per-service probes can honestly promise.
    it('leaves the per-dependency status open, since each probe classifies its own failures', () => {
      const schema = spec.components.schemas.ReadinessResponse as {
        allOf: Array<{
          properties?: Record<string, { additionalProperties?: { enum?: string[] } }>;
        }>;
      };
      const services = schema.allOf[1]!.properties?.services;
      expect(services?.additionalProperties?.enum).toBeUndefined();
    });
  });

  describe('Device Authorization (RFC 8628) — #195', () => {
    // Field-list / enum snapshot against api.yaml (the #186 CatalogExportRow house
    // style — NOT a live runtime diff; the plugin's per-route zod schemas are
    // module-internal and unexported). Error enums are the RUNTIME superset of
    // the declared zod.
    //
    // WHICH better-auth these shapes came from, stated precisely because the
    // answer is not the version this repo installs: the device-plugin wire
    // shapes were read off 1.6.20 (+ Backend-Service#1495) and have not been
    // re-diffed since. The version apps/auth actually loads is 1.6.30
    // (Backend-Service's apps/auth/node_modules/better-auth) — see api.yaml's
    // device-section header. The pin at the bottom of this describe asserts on
    // wxyc-shared's OWN dev dependency, which is a third version again; read
    // that test's comment before treating its string as the mirrored version.
    type Schema = {
      type?: string;
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
      enum?: string[];
    };
    type Operation = {
      security?: Array<Record<string, unknown[]>>;
      parameters?: Array<{ name: string; in: string; required?: boolean }>;
      responses?: Record<
        string,
        {
          content?: Record<string, { schema?: { $ref?: string } }>;
          headers?: Record<string, unknown>;
        }
      >;
    };
    const getSchema = (name: string) => spec.components.schemas[name] as Schema;
    const props = (name: string) => Object.keys(getSchema(name).properties ?? {}).sort();

    it('declares all five /auth/device/* paths with the right methods', () => {
      expect((spec.paths['/auth/device/code'] as Record<string, unknown>)?.post).toBeDefined();
      expect((spec.paths['/auth/device/token'] as Record<string, unknown>)?.post).toBeDefined();
      expect((spec.paths['/auth/device'] as Record<string, unknown>)?.get).toBeDefined();
      expect((spec.paths['/auth/device/approve'] as Record<string, unknown>)?.post).toBeDefined();
      expect((spec.paths['/auth/device/deny'] as Record<string, unknown>)?.post).toBeDefined();
    });

    // ---- Request/response field lists (snapshot vs the verified plugin wire shapes) ----

    it('DeviceAuthCodeRequest = { client_id (req), scope?, user_id? } — user_id is the 1.6.20 pre-bind field', () => {
      expect(props('DeviceAuthCodeRequest')).toEqual(['client_id', 'scope', 'user_id'].sort());
      expect(getSchema('DeviceAuthCodeRequest').required).toEqual(['client_id']);
    });

    it('DeviceAuthCodeResponse carries all six RFC 8628 fields, all required', () => {
      const fields = [
        'device_code',
        'user_code',
        'verification_uri',
        'verification_uri_complete',
        'expires_in',
        'interval',
      ];
      expect(props('DeviceAuthCodeResponse')).toEqual([...fields].sort());
      expect((getSchema('DeviceAuthCodeResponse').required ?? []).sort()).toEqual([...fields].sort());
    });

    it('DeviceAuthTokenRequest preserves snake_case + a fixed grant_type literal', () => {
      expect(props('DeviceAuthTokenRequest')).toEqual(['client_id', 'device_code', 'grant_type'].sort());
      expect(getSchema('DeviceAuthTokenRequest').properties?.grant_type?.enum).toEqual([
        'urn:ietf:params:oauth:grant-type:device_code',
      ]);
    });

    it('DeviceAuthTokenResponse carries all four runtime fields INCLUDING scope (token_type fixed to Bearer)', () => {
      const fields = ['access_token', 'token_type', 'expires_in', 'scope'];
      expect(props('DeviceAuthTokenResponse')).toEqual([...fields].sort());
      expect((getSchema('DeviceAuthTokenResponse').required ?? []).sort()).toEqual([...fields].sort());
      expect(getSchema('DeviceAuthTokenResponse').properties?.token_type?.enum).toEqual(['Bearer']);
      // expires_in stays a plain integer — BS clamps the VALUE to 43200, not the type.
      expect(getSchema('DeviceAuthTokenResponse').properties?.expires_in?.type).toBe('integer');
    });

    it('DeviceAuthVerifyResponse = { user_code, status } with status the [pending,approved,denied] enum', () => {
      expect(props('DeviceAuthVerifyResponse')).toEqual(['status', 'user_code']);
      expect(getSchema('DeviceAuthVerifyResponse').properties?.status?.$ref).toBe(
        '#/components/schemas/DeviceAuthStatus'
      );
      expect(getSchema('DeviceAuthStatus').enum).toEqual(['pending', 'approved', 'denied']);
    });

    it('approve + deny request bodies use camelCase userCode (NOT snake_case)', () => {
      for (const name of ['DeviceAuthApproveRequest', 'DeviceAuthDenyRequest']) {
        expect(props(name), name).toEqual(['userCode']);
        expect(getSchema(name).required, name).toEqual(['userCode']);
        expect(getSchema(name).properties?.user_code, name).toBeUndefined();
      }
    });

    it('DeviceAuthActionResponse is a plain { success: boolean }', () => {
      expect(props('DeviceAuthActionResponse')).toEqual(['success']);
      expect(getSchema('DeviceAuthActionResponse').properties?.success?.type).toBe('boolean');
    });

    // ---- Per-endpoint error enums mirror RUNTIME (a superset of the declared zod) ----

    it('pins each per-endpoint error enum to the runtime vocabulary', () => {
      expect(getSchema('DeviceAuthCodeErrorCode').enum).toEqual(['invalid_request', 'invalid_client']);
      expect(getSchema('DeviceAuthTokenErrorCode').enum).toEqual([
        'authorization_pending',
        'slow_down',
        'expired_token',
        'access_denied',
        'invalid_request',
        'invalid_grant',
        'server_error',
      ]);
      expect(getSchema('DeviceAuthVerifyErrorCode').enum).toEqual(['invalid_request', 'expired_token']);
      expect(getSchema('DeviceAuthActionErrorCode').enum).toEqual([
        'invalid_request',
        'expired_token',
        'unauthorized',
        'access_denied',
      ]);
    });

    it('includes runtime-only codes the declared zod omits (server_error on token, expired_token on verify)', () => {
      expect(getSchema('DeviceAuthTokenErrorCode').enum).toContain('server_error');
      expect(getSchema('DeviceAuthVerifyErrorCode').enum).toContain('expired_token');
    });

    it('drops device_code_already_processed — declared in approve zod but never a wire error', () => {
      expect(getSchema('DeviceAuthActionErrorCode').enum).not.toContain('device_code_already_processed');
    });

    // ---- security per endpoint ----

    // The session-bearing device operations declare SessionBearerAuth, NOT the
    // JWT-carrying BearerAuth they were originally written with. Their handlers
    // call `getSessionFromCtx` (better-auth
    // dist/plugins/device-authorization/routes.mjs), which the bearer plugin
    // feeds from a SESSION token — the credential BearerAuth's own description
    // ("JWT token from Better Auth") explicitly is not. The mistake was not
    // cosmetic: a generated client reading this document would have reached for
    // its JWT credential store on approve/deny and been rejected, and the
    // SessionBearerAuth scheme exists precisely to make that reach impossible.
    it('declares the session-bearing device ops under SessionBearerAuth, not the JWT BearerAuth', () => {
      expect((spec.paths['/auth/device/code'] as { post: Operation }).post.security).toEqual([]);
      expect((spec.paths['/auth/device/token'] as { post: Operation }).post.security).toEqual([]);
      expect((spec.paths['/auth/device/approve'] as { post: Operation }).post.security).toEqual([
        { SessionBearerAuth: [] },
      ]);
      expect((spec.paths['/auth/device/deny'] as { post: Operation }).post.security).toEqual([
        { SessionBearerAuth: [] },
      ]);
      // GET /device works unauthenticated (200 + status); a session only claims the code.
      expect((spec.paths['/auth/device'] as { get: Operation }).get.security).toEqual([
        {},
        { SessionBearerAuth: [] },
      ]);
    });

    // Guards the regression directly rather than only pinning the good state:
    // no device operation may name BearerAuth at all. Without this, a future
    // edit re-introducing the JWT scheme on one of the five would only be
    // caught if it also happened to change the exact `toEqual` shapes above.
    it('names BearerAuth on no device operation', () => {
      const deviceRoutes = [
        '/auth/device',
        '/auth/device/code',
        '/auth/device/token',
        '/auth/device/approve',
        '/auth/device/deny',
      ];
      const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
      for (const route of deviceRoutes) {
        const item = spec.paths[route] as Record<string, Operation>;
        expect(item, route).toBeDefined();
        for (const method of httpMethods) {
          const op = item[method];
          if (!op) continue;
          const names = (op.security ?? []).flatMap((req) => Object.keys(req));
          expect(names, `${method.toUpperCase()} ${route}`).not.toContain('BearerAuth');
        }
      }
    });

    // ---- per-status error blocks reference the right envelope ----

    it('models /device/token errors per status (400 + 429 + 500); the two plugin statuses are DeviceAuthTokenError', () => {
      const r = (spec.paths['/auth/device/token'] as { post: Operation }).post.responses!;
      expect(Object.keys(r).sort()).toEqual(['200', '400', '429', '500']);
      expect(r['400']!.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
      expect(r['500']!.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
    });

    it('models approve/deny errors per status (400 + 401 + 403 + 429); the three plugin statuses are DeviceAuthActionError', () => {
      for (const route of ['/auth/device/approve', '/auth/device/deny']) {
        const r = (spec.paths[route] as { post: Operation }).post.responses!;
        expect(Object.keys(r).sort(), route).toEqual(['200', '400', '401', '403', '429']);
        for (const code of ['400', '401', '403']) {
          expect(r[code]!.content?.['application/json']?.schema?.$ref, `${route} ${code}`).toBe(
            '#/components/schemas/DeviceAuthActionError'
          );
        }
      }
    });

    it('models /device/code and GET /device errors as 400 + 429, each with its own 400 envelope', () => {
      const codeR = (spec.paths['/auth/device/code'] as { post: Operation }).post.responses!;
      expect(Object.keys(codeR).sort()).toEqual(['200', '400', '429']);
      expect(codeR['400']!.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DeviceAuthCodeError'
      );
      const verifyR = (spec.paths['/auth/device'] as { get: Operation }).get.responses!;
      expect(Object.keys(verifyR).sort()).toEqual(['200', '400', '429']);
      expect(verifyR['400']!.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DeviceAuthVerifyError'
      );
    });

    // Every device operation is rate-limited, but by DIFFERENT layers, and the
    // shape a client must decode differs accordingly. The three paths mounted
    // behind Express's authMutationRateLimit (apps/auth/app.ts
    // `rateLimitedPaths`) answer `{error}` — AuthPlainErrorResponse — and set
    // the standard `Retry-After`. The two the express layer deliberately skips
    // (/device/token, whose `slow_down` body a 429 would shadow; GET /device,
    // which cannot be mounted without prefix-matching /device/token) fall
    // through to better-auth's own limiter, which answers `{message}` —
    // AuthRateLimitedResponse — and sets the non-standard `X-Retry-After`.
    //
    // The single-shape modeling is load-bearing and the derivation is easy to
    // get backwards: on /auth/sign-in/* the 429 is a oneOf because better-auth's
    // 3-per-10s special rule bites BEFORE the shared 10-per-15-min express
    // bucket. On /device/* that ordering INVERTS — `getDefaultSpecialRules()`
    // matches no device path, so better-auth falls back to its general
    // 100-per-10s default, which the express bucket always exhausts first. Any
    // future edit that "harmonizes" these into a oneOf for consistency with the
    // sign-in routes would be documenting an unreachable branch.
    it('models each device 429 against the layer that actually answers it', () => {
      const plainLimited = ['/auth/device/code', '/auth/device/approve', '/auth/device/deny'];
      for (const route of plainLimited) {
        const r = (spec.paths[route] as { post: Operation }).post.responses!['429'];
        expect(r!.content?.['application/json']?.schema?.$ref, route).toBe(
          '#/components/schemas/AuthPlainErrorResponse'
        );
        expect(Object.keys(r!.headers ?? {}), route).toEqual(['Retry-After']);
      }

      const betterAuthLimited: Array<[string, 'get' | 'post']> = [
        ['/auth/device/token', 'post'],
        ['/auth/device', 'get'],
      ];
      for (const [route, method] of betterAuthLimited) {
        const r = (spec.paths[route] as Record<string, Operation>)[method]!.responses!['429'];
        expect(r!.content?.['application/json']?.schema?.$ref, route).toBe(
          '#/components/schemas/AuthRateLimitedResponse'
        );
        expect(Object.keys(r!.headers ?? {}), route).toEqual(['X-Retry-After']);
      }
    });

    it('wires each endpoint 200 success response to its own response schema', () => {
      const okRef = (op: Operation) => op.responses!['200']!.content?.['application/json']?.schema?.$ref;
      expect(okRef((spec.paths['/auth/device/code'] as { post: Operation }).post)).toBe(
        '#/components/schemas/DeviceAuthCodeResponse'
      );
      expect(okRef((spec.paths['/auth/device/token'] as { post: Operation }).post)).toBe(
        '#/components/schemas/DeviceAuthTokenResponse'
      );
      expect(okRef((spec.paths['/auth/device'] as { get: Operation }).get)).toBe(
        '#/components/schemas/DeviceAuthVerifyResponse'
      );
      expect(okRef((spec.paths['/auth/device/approve'] as { post: Operation }).post)).toBe(
        '#/components/schemas/DeviceAuthActionResponse'
      );
      expect(okRef((spec.paths['/auth/device/deny'] as { post: Operation }).post)).toBe(
        '#/components/schemas/DeviceAuthActionResponse'
      );
    });

    it('GET /auth/device takes a required user_code query param', () => {
      const op = (spec.paths['/auth/device'] as { get: Operation }).get;
      const userCode = op.parameters?.find((p) => p.name === 'user_code');
      expect(userCode?.in).toBe('query');
      expect(userCode?.required).toBe(true);
    });

    // ---- version forcing-function ----

    it('pins this repo\'s better-auth dev dependency as a tripwire on the mirrored wire shapes', () => {
      // READ THIS BEFORE BUMPING THE STRING. What this asserts on is
      // wxyc-shared's OWN node_modules/better-auth — a dev dependency of a
      // package that serves no HTTP traffic. It is NOT the version the shapes
      // above were verified against, and it is NOT the version the deployed
      // auth service runs (that is Backend-Service's apps/auth copy, 1.6.30 at
      // the time of writing). This repo has no visibility into Backend-Service's
      // lockfile, so it cannot assert on the version that actually matters.
      //
      // It earns its place anyway, as a TRIPWIRE rather than a verification: a
      // dependabot bump here is the event most likely to coincide with an
      // upstream wire change, and it is the only better-auth signal this repo's
      // CI can see. Treat a failure as "go re-read routes.mjs", never as
      // "the mirror has been re-verified".
      //
      // Bumping this string is a three-part job, and doing only the third part
      // defeats the whole mechanism: re-diff routes.mjs against the new
      // version, update the enums/fields above to match, THEN bump.
      //
      // Re-verified 2026-08-25 for the 1.6.25→1.7.1 bump. `routes.mjs` diffs by
      // ~670 lines, but every wire-relevant line moves as a reformat, not a
      // change — checked by property rather than by reading the diff:
      //   - error-codes.mjs: all 13 codes identical, none added or removed.
      //   - schema.mjs: the nine deviceCode fields are identical in name, type,
      //     and required flag. The ONLY delta is an added `indexes: [...]`
      //     declaring UNIQUE on deviceCode and userCode — a storage concern,
      //     not a wire one. It is a migration concern for whoever runs
      //     better-auth (Backend-Service), not for this mirror.
      //   - The mixed-casing contract holds: camelCase `userCode` in the
      //     plugin's own model and in approve/deny bodies, snake_case
      //     `user_code` on the RFC 8628 wire (8 occurrences, unchanged).
      //   - status literals still exactly "pending" | "approved" | "denied".
      //   - `getSessionFromCtx` still resolves approve/deny (4 call sites,
      //     unchanged), so #399's SessionBearerAuth-not-BearerAuth decision
      //     stands.
      //
      // Two surfaces outside device-auth that this repo now also mirrors were
      // checked, since #399 widened the spec past the QR flow:
      //   - Rate limiting: api/rate-limiter/index.mjs is a large internal
      //     refactor (multi-window TTL handling), but getDefaultSpecialRules()
      //     returns identical VALUES — 3/10s on /sign-in*, /sign-up*,
      //     /change-password*, /change-email*, and 3/60s on the
      //     password-reset/OTP-send family. That is what AuthRateLimitedResponse
      //     and the device-429 layering argument rest on.
      //   - CONTRACTS.SET_AUTH_TOKEN_NEVER_ROTATES: the /auth/token roll-forward
      //     is byte-identical — `updateSession(session.session.token, {expiresAt,
      //     updatedAt})`, keyed on the token, writing only the two timestamps,
      //     with no `token: generateId` anywhere in session.mjs. plugins/bearer
      //     is identical outright. The contract survives the bump.
      //
      // Re-verified 2026-09-16 for the 1.7.1→1.7.4 bump, and this one settles
      // by identity rather than by argument: every mirrored runtime file is
      // byte-identical between the two versions, confirmed by SHA-256 rather
      // than by reading a diff. routes.mjs, schema.mjs, error-codes.mjs,
      // index.mjs, api/rate-limiter/index.mjs and plugins/bearer/index.mjs all
      // match. Nothing above needed updating, which is a finding, not a
      // skipped step — checksums first, THEN the bump.
      //
      // Two deltas exist nearby and neither reaches this mirror:
      //   - device-authorization/index.d.mts: types only. zod inference
      //     plumbing — `-readonly` mapped-type stripping and renumbered infer
      //     variables. The declared field union is still exactly
      //     "scope" | "user_id" | "client_id".
      //   - api/routes/session.mjs: cookie-cache handling. With
      //     `session.cookieCache.enabled` false (the default), a stale
      //     `session_data` cookie is now cleaned instead of decoded. Behavior
      //     for whoever RUNS better-auth, like 1.7.1's `indexes:` delta — a
      //     Backend-Service concern, not a wire shape this spec describes.
      //
      // 1.7.4 also widens the vitest peer range to admit ^5.0.0, which 1.7.1
      // did not. That is what unblocks the vitest 5 dev-dependency bump; the
      // two have to land in this order or `npm install` fails to resolve.
      const ba = JSON.parse(
        readFileSync(join(__dirname, '..', 'node_modules', 'better-auth', 'package.json'), 'utf-8')
      ) as { version: string };
      expect(ba.version).toBe('1.7.4');
    });
  });
  describe('Song like tallies (POST /likes/tally)', () => {
    // The iOS Phase 4 client and the Backend-Service Phase 3 endpoint are both
    // generated from this block, and its privacy properties are load-bearing:
    // the endpoint must never grow a listener key. See WXYC/wxyc-ios-64#979.

    const prop = (schema: string, name: string) =>
      (spec.components.schemas[schema] as { properties?: Record<string, Record<string, unknown>> })
        .properties?.[name];

    it('declares POST /likes/tally and no per-listener likes path', () => {
      const paths = spec.paths as Record<string, unknown>;
      expect(paths['/likes/tally']).toBeDefined();
      expect((paths['/likes/tally'] as Record<string, unknown>).post).toBeDefined();
      // The superseded full-snapshot design must not come back.
      expect(paths['/listeners/me/likes']).toBeUndefined();
    });

    it('SongLikeDelta requires song_key, song_title, artist_name and delta', () => {
      const delta = spec.components.schemas.SongLikeDelta as { required?: string[] };
      expect(delta).toBeDefined();
      expect(delta.required).toEqual(['song_key', 'song_title', 'artist_name', 'delta']);
    });

    it('pins delta to exactly +1 / -1', () => {
      const d = prop('SongLikeDelta', 'delta');
      expect(d?.type).toBe('integer');
      expect(d?.enum).toEqual([-1, 1]);
    });

    it('keeps release_title and artist_id optional — name-only likes are normal', () => {
      const delta = spec.components.schemas.SongLikeDelta as { required?: string[] };
      expect(delta.required).not.toContain('release_title');
      expect(delta.required).not.toContain('artist_id');
      expect(prop('SongLikeDelta', 'release_title')).toBeDefined();
      expect(prop('SongLikeDelta', 'artist_id')).toBeDefined();
    });

    it('carries no listener, session, device or user field anywhere in the tally schemas', () => {
      // The whole point of the design: nothing written here may be attributable.
      for (const name of ['SongLikeDelta', 'SongLikeTallyRequest', 'SongLikeTallyResponse']) {
        const schema = spec.components.schemas[name] as { properties?: Record<string, unknown> };
        for (const prop of Object.keys(schema.properties ?? {})) {
          expect(prop).not.toMatch(/listener|session|device|user|distinct|anon/i);
        }
      }
    });

    it('bounds the deltas batch at both ends', () => {
      const deltas = prop('SongLikeTallyRequest', 'deltas');
      expect(deltas?.type).toBe('array');
      expect(deltas?.minItems).toBe(1);
      expect(deltas?.maxItems).toBe(1000);
      expect((deltas?.items as { $ref?: string })?.$ref).toBe('#/components/schemas/SongLikeDelta');
    });

    it('returns applied + resolved counts', () => {
      const res = spec.components.schemas.SongLikeTallyResponse as { required?: string[] };
      expect(res.required).toEqual(['applied', 'resolved']);
    });
  });

  // Every schema in `components.schemas` should be reachable by following
  // `$ref` from a path (or from a non-schema component). One that is not still
  // generates a public type in four languages on every codegen run, and until
  // this guard existed nothing noticed: 79 of 284 had accumulated.
  //
  // Reachability is transitive. `OnAirDJ` is referenced only by other schemas,
  // and is alive because those are reachable; a schema referenced ONLY by an
  // unreachable schema is itself unreachable, so the closure is what decides.
  describe('schema reachability (#476)', () => {
    // Every name below is unreachable and stays that way deliberately. The
    // lists are grouped by WHY, because the remedy differs per group and a
    // single flat list hid that: what follows is the verdict of the #476
    // sweep, not a backlog. The sweep's finding is that "unreachable" in this
    // contract almost never means "unused" -- codegen emits the whole
    // components table, so a consumer imports any schema it likes whether or
    // not a path references it. Path-reachability measures what the SPEC
    // references; it has never measured what the org uses.

    // The AutoDJ WebSocket protocol. `AutoDJWebSocketMessage` is a
    // discriminated union over six message types and OpenAPI paths cannot
    // describe a socket, so unreachability is the correct state here, not a
    // finding. Permanent -- this group is not expected to shrink.
    const WEBSOCKET_PROTOCOL = [
    'AutoDJAck', 'AutoDJActivationSource', 'AutoDJActivationSourceType', 'AutoDJButtonToggle',
    'AutoDJCommand', 'AutoDJCommandAction', 'AutoDJCurrentTrack', 'AutoDJDeactivateResponse',
    'AutoDJDeviceStatus', 'AutoDJDeviceSummary', 'AutoDJErrorCode', 'AutoDJErrorLevel',
    'AutoDJErrorReport', 'AutoDJHeartbeat', 'AutoDJLastTrack', 'AutoDJNowPlaying',
    'AutoDJRelayState', 'AutoDJState', 'AutoDJStatus', 'AutoDJTransport', 'AutoDJWebSocketMessage',
    ];

    // Imported by hand-written code in at least one consumer, found by
    // sweeping every consumer repo for references outside `generated/` and the
    // vendored Swift trees. Deleting one breaks a build somewhere, so this
    // list is permanent and is not expected to shrink.
    //
    // Most entries are plain imports -- `AlbumReview` and `AlbumReviewsResponse`
    // from Backend-Service's album-reviews service and controller, the `Discogs*`
    // family from library-metadata-lookup's `discogs/models.py` (which imports
    // them from `generated.api_models` and re-aliases them) and from
    // Backend-Service's `shared/lml-client`, `HealthCheckResponse` from both
    // Backend-Service apps' health handlers, `PlaylistSearchParams` from three
    // dj-site modules. Three are not, and each would read as deletable to a
    // grep that only looked for imports:
    //
    //   - The four `Flowsheet*Entry` variants are imported by THIS package's
    //     `src/dtos/extensions.ts`, which unions them into `FlowsheetEntry` and
    //     builds its type guards. Deleting them breaks the build here.
    //   - `StreamingLinks` is named by library-metadata-lookup's codegen pin
    //     test as one of five classes that must carry the pinned streaming-URL
    //     fields as `str`. No code imports the type; a test asserts the class
    //     exists with that shape.
    //   - `RotationWithAlbum` has no consumer yet. It is declared ahead of
    //     implementation -- `album_id` + `rotation_bin` over `RotationEntry` is
    //     the rotation-admin shape, and that work is in flight. `Rotation`, the
    //     shape `GET /library/rotation` actually serves, is a superset of it in
    //     every field but those two.
    const GENERATED_TYPE_VOCABULARY = [
    'AddToBinRequest', 'AlbumMetadata', 'AlbumReview', 'AlbumReviewsResponse', 'ArtistMetadata',
    'BinLibraryDetails', 'DateTimeEntry', 'DiscogsArtistCredit', 'DiscogsArtistDetails',
    'DiscogsLabelCredit', 'DiscogsReleaseInfo', 'DiscogsReleaseMetadata', 'DiscogsReleaseVideo',
    'DiscogsTrackReleasesResponse', 'FlowsheetBreakpointEntry', 'FlowsheetMessageEntry',
    'FlowsheetQueryParams', 'FlowsheetShowBlockEntry', 'FlowsheetSongEntry', 'HealthCheckResponse',
    'LibrarySearchItem', 'LibrarySearchResponse', 'MetadataSource', 'PaginationParams',
    'ParsedSongRequest', 'PlaylistSearchParams', 'RequestStatus', 'RotationWithAlbum',
    'SongRequest', 'StreamingCheckResponse', 'StreamingCheckSources', 'StreamingLinks',
    'StreamingSourceMatch',
    ];

    // No importer, and no path here to attach them to: these describe payloads
    // of endpoints this contract does not declare. `ReadinessResponse` is the
    // readiness half of a health pair whose other half (`HealthCheckResponse`)
    // both Backend-Service apps import, and no `/healthcheck` or `/ready` path
    // is declared. `StreamingCheckRequest` is the request body for
    // library-metadata-lookup's streaming check, whose RESPONSE
    // (`StreamingCheckResponse`) Backend-Service's lml-client imports; LML
    // itself defines the request locally in `streaming/models.py` rather than
    // importing the generated one. Deleting either would make the contract
    // less truthful, not more -- the endpoints exist.
    const ENDPOINT_NOT_DECLARED_HERE = [
    'ReadinessResponse', 'StreamingCheckRequest',
    ];

    const EXEMPT = new Set([
      ...WEBSOCKET_PROTOCOL,
      ...GENERATED_TYPE_VOCABULARY,
      ...ENDPOINT_NOT_DECLARED_HERE,
    ]);

    function reachableSchemas(): Set<string> {
      const schemas = spec.components.schemas as Record<string, unknown>;
      const collect = (node: unknown, out: Set<string>): void => {
        if (Array.isArray(node)) {
          for (const child of node) collect(child, out);
          return;
        }
        if (node === null || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (key === '$ref' && typeof value === 'string' && value.includes('/schemas/')) {
            out.add(value.slice(value.lastIndexOf('/') + 1));
          } else {
            collect(value, out);
          }
        }
      };

      // Roots are the paths plus every non-schema component (securitySchemes,
      // parameters, responses...), since those are entry points too.
      const roots = new Set<string>();
      collect(spec.paths, roots);
      for (const [key, value] of Object.entries(spec.components as Record<string, unknown>)) {
        if (key !== 'schemas') collect(value, roots);
      }

      const alive = new Set<string>();
      const frontier = [...roots];
      while (frontier.length > 0) {
        const name = frontier.pop()!;
        if (alive.has(name) || !(name in schemas)) continue;
        alive.add(name);
        const children = new Set<string>();
        collect(schemas[name], children);
        frontier.push(...children);
      }
      return alive;
    }

    it('declares no schema that no path can reach', () => {
      const alive = reachableSchemas();
      const orphans = Object.keys(spec.components.schemas)
        .filter((name) => !alive.has(name) && !EXEMPT.has(name))
        .sort();
      expect(orphans).toEqual([]);
    });

    // The counterpart, and the half that keeps the lists honest. An exemption
    // that outlives its reason is worse than no exemption: it reads as a
    // considered decision while describing a state that no longer holds. The
    // same rot the oasdiff whitelist is pruned for.
    it('carries no exemption for a schema that is now reachable', () => {
      const alive = reachableSchemas();
      const stale = [...EXEMPT].filter((name) => alive.has(name)).sort();
      expect(stale).toEqual([]);
    });

    it('exempts nothing that no longer exists', () => {
      const schemas = spec.components.schemas as Record<string, unknown>;
      const vanished = [...EXEMPT].filter((name) => !(name in schemas)).sort();
      expect(vanished).toEqual([]);
    });
  });
  // Every assertion here pins a declaration against the handler that serves
  // it, because six of them were wrong at once and every one failed the same
  // way: silently, in a generated client, on a screen a librarian was using to
  // make an irreversible decision. Nothing in this suite covered the new
  // operations, so a spec authored from an issue body rather than from the
  // shipped code could not be contradicted by a test.
  describe('Catalog delete / restore declarations match the handlers (wxyc-shared#503)', () => {
    const restorePath = '/library/deleted/{batchId}/restore';

    // These THROW on absence rather than asserting it, because
    // `expect(...).toBeDefined()` does not narrow the type for the caller --
    // it satisfies the runtime and leaves every subsequent access a
    // strict-null error. A throw is also the right failure: a missing
    // operation makes every assertion below it meaningless, so naming the
    // path once beats a cascade of undefined-property failures.
    function operation(path: string, method: string): Record<string, unknown> {
      const item = (spec.paths as Record<string, Record<string, unknown> | undefined>)[path];
      if (!item) throw new Error(`api.yaml declares no path ${path}`);
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) throw new Error(`api.yaml declares no ${method.toUpperCase()} on ${path}`);
      return op;
    }

    function responseSchema(path: string, method: string, status: string): Record<string, unknown> {
      const responses = operation(path, method).responses as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const response = responses[status];
      if (!response) throw new Error(`${method.toUpperCase()} ${path} declares no ${status}`);
      const content = response.content as Record<string, Record<string, unknown> | undefined> | undefined;
      const json = content?.['application/json'];
      if (!json) throw new Error(`${method.toUpperCase()} ${path} ${status} declares no JSON body`);
      return json.schema as Record<string, unknown>;
    }

    // Matches `operation`'s throw-on-absence shape: a missing schema makes
    // every assertion below it meaningless, so naming it once beats a
    // cascade of undefined-property failures. Reaches a schema's OWN
    // description (not a property's, which `propertyOf` already covers).
    function schema(name: string): Record<string, unknown> {
      const found = (spec.components.schemas as Record<string, Record<string, unknown> | undefined>)[name];
      if (!found) throw new Error(`api.yaml declares no schema ${name}`);
      return found;
    }

    /** The schema names a `oneOf` response branches over, in declaration order. */
    function oneOfNames(schema: Record<string, unknown>): string[] {
      const branches = (schema.oneOf as Array<{ $ref?: string }> | undefined) ?? [];
      return branches.map((branch) => (branch.$ref ?? '').split('/').pop() ?? '');
    }

    describe('POST /library/deleted/{batchId}/restore', () => {
      // The field name is the whole contract for this request. Declared as
      // `code_conflict_resolution`, every generated client sent a key the
      // handler does not read, so `resolution` came back undefined and the
      // answer was the same 400 an empty body gets -- an unreachable endpoint
      // whose only working spelling was undocumented.
      it('names the resolution field `resolution`, with the handler’s two values', () => {
        const body = operation(restorePath, 'post').requestBody as Record<string, unknown>;
        const content = body.content as Record<string, Record<string, unknown> | undefined>;
        const json = content['application/json'];
        if (!json) throw new Error('the restore requestBody declares no JSON body');
        const schema = json.schema as Record<string, unknown>;
        const properties = schema.properties as Record<string, Record<string, unknown> | undefined>;

        expect(Object.keys(properties)).toEqual(['resolution']);
        expect(properties.resolution?.enum).toEqual(['next_free_code', 'decline']);
      });

      // A 400, not a 409: the request is incomplete rather than in conflict
      // with server state, and the same batch succeeds the moment `resolution`
      // is supplied. The branch must be typed -- collapsing it to the bare
      // error shape discards `conflicts` and leaves the screen nothing to ask
      // the question from.
      it('declares the slot-conflict refusal on the 400, alongside the malformed-request shape', () => {
        expect(oneOfNames(responseSchema(restorePath, 'post', '400'))).toEqual([
          'RestoreResolutionRequiredRefusal',
          'ApiErrorResponse',
        ]);
      });

      // Three different 409s (wxyc-shared#512 added the third). Handling
      // `already_restored` as a code conflict prompts for a call-number
      // decision on a batch that is already fully back in the catalog,
      // which is what a lenient decoder does when the reason is outside a
      // declared enum.
      it('declares all three 409 refusals, so already_restored is not read as a code conflict', () => {
        expect(oneOfNames(responseSchema(restorePath, 'post', '409')).sort()).toEqual([
          'RestoreAlreadyRestoredRefusal',
          'RestoreDeclinedRefusal',
          'RestoreUnrestorableKindRefusal',
        ]);
      });

      it('declares the 503 stand-down and the 404, and no other statuses', () => {
        const responses = operation(restorePath, 'post').responses as Record<string, unknown>;
        expect(Object.keys(responses).sort()).toEqual(['200', '400', '404', '409', '503']);
      });
    });

    describe('RestoredEntity', () => {
      // Declared `id`; the wire sends `entity_id`. Every generated client that
      // is non-optional by default -- Swift Codable, kotlinx.serialization --
      // throws on the missing required key, so a restore that SUCCEEDED
      // surfaced as a decode error.
      it('requires the keys the handler emits, and never a bare `id`', () => {
        expect(requiredKeysOf('RestoredEntity').sort()).toEqual(
          ['children', 'entity_id', 'entity_kind', 'relocated_code_number', 'table'].sort()
        );
        expect(propertyKeysOf('RestoredEntity')).not.toContain('id');
      });

      // The relocation answer is per entity, because only the entities whose
      // own slot was taken move.
      it('carries the relocation result as a nullable per-entity code number', () => {
        const relocated = propertyOf('RestoredEntity', 'relocated_code_number');
        expect(relocated?.type).toBe('integer');
        expect(relocated?.nullable).toBe(true);
      });
    });

    describe('RestoreBatchResponse', () => {
      // Both were authored from the issue body and neither is ever emitted, so
      // a consumer reading `reassigned_code` got null while the real value sat
      // in an undeclared field on each entity.
      it('declares no batch-level resolution fields the handler never sends', () => {
        const keys = propertyKeysOf('RestoreBatchResponse');
        expect(keys.sort()).toEqual(['batch_id', 'entities']);
        expect(keys).not.toContain('code_conflict_resolution_applied');
        expect(keys).not.toContain('reassigned_code');
      });
    });

    describe('RestoreSlotConflict', () => {
      it('requires exactly the seven fields the handler puts on each conflict', () => {
        expect(requiredKeysOf('RestoreSlotConflict').sort()).toEqual(
          [
            'artist_id',
            'code_number',
            'code_volume_letters',
            'entity_id',
            'genre_id',
            'next_free_code_number',
            'occupied_by_library_id',
          ].sort()
        );
      });

      // Deliberately absent: the shelf letters belong to the artist, not the
      // release, so a conflict row has no `code_letters` to carry. The earlier
      // declaration required one, which no reply could satisfy.
      it('carries no code_letters', () => {
        expect(propertyKeysOf('RestoreSlotConflict')).not.toContain('code_letters');
      });
    });

    describe('ArtistDeleteRefusal', () => {
      // Declared as the full five-count dependent card via allOf; the handler
      // answers three fields. A client generated from the old declaration
      // required artist_id, artist_name, alphabetical_name, genre_id,
      // code_letters, code_artist_number and five *_count fields on a body
      // carrying none of them -- so the decode failed outright and `count`,
      // the one number the refusal exists to communicate, was untyped.
      it('declares the three fields the handler answers with, not the dependent-count card', () => {
        expect(requiredKeysOf('ArtistDeleteRefusal').sort()).toEqual(['count', 'message', 'reason']);
        expect(propertyKeysOf('ArtistDeleteRefusal').sort()).toEqual(['count', 'message', 'reason']);
      });

      it('keeps the four refusal reasons, and only those', () => {
        expect(propertyOf('ArtistDeleteRefusal', 'reason')?.enum).toEqual([
          'artist_has_releases',
          'artist_crossreference_source',
          'artist_crossreference_target',
          'artist_library_crossreference',
        ]);
      });
    });

    describe('GET /library/artists/{id}/next-release-number (wxyc-shared#511)', () => {
      function description(): string {
        return String(operation('/library/artists/{id}/next-release-number', 'get').description);
      }

      // A genre-blind peek proposes a number from the wrong shelf, and the
      // librarian writes it on a card. The contract declares the parameter
      // required independent of whether any GIVEN deployed handler's number
      // generator actually reads it yet -- see the description's own
      // caveat below, which is exactly the gap between "declared" and
      // "deployed" this parameter lives in.
      it('requires genre_id as a query parameter', () => {
        const parameters = operation('/library/artists/{id}/next-release-number', 'get')
          .parameters as Array<Record<string, unknown>>;
        const genre = parameters.find((parameter) => parameter.name === 'genre_id');

        expect(genre).toBeDefined();
        expect(genre?.in).toBe('query');
        expect(genre?.required).toBe(true);
      });

      // Neither a ticket number nor a status word ("pending"/"shipped"/"in
      // flight") survives a merge, a renumbering, or deploy timing that
      // diverges from contract publication -- the old sentence cited
      // WXYC/Backend-Service#2587 as "pending", which goes false the
      // instant that PR lands and the description is never revisited. The
      // only fact worth telling a client is what it can and cannot
      // conclude from the 200 body itself, which is true whether or not
      // the Backend change has shipped (wxyc-shared#511).
      it('states the observable effect only, with no ticket or status word', () => {
        expect(description()).toMatch(
          /cannot tell from the response body alone whether that number was chosen within one genre's shelf or across every genre/i
        );
        expect(description()).not.toMatch(/WXYC\/Backend-Service#\d+/);
        expect(description()).not.toMatch(/\b(pending|shipped|in flight)\b/i);
      });

      // Two DIFFERENT ways a not-yet-scoped generator can diverge from the
      // declared contract: it can compute artist-wide instead of
      // genre-scoped (a supplied genre_id is ignored), and separately it
      // can accept the request even when genre_id is missing instead of
      // answering the declared 400 (the parameter's presence is never
      // checked). The prior wording disclosed only the first.
      it('discloses both ways a deployed generator can diverge from the declared contract', () => {
        expect(description()).toMatch(/artist-wide MAX\+1/);
        expect(description()).toMatch(/even when `?genre_id`? is missing/i);
      });

      // "Harmless" was true only for the REQUEST, not for the number a DJ
      // then writes on a physical card -- asserting it bare, right after
      // explaining why a wrong number is the actual danger, reads as a
      // safety guarantee the sentence does not back up.
      it('does not call sending genre_id "harmless" outright', () => {
        expect(description()).not.toMatch(/\bis harmless\b/i);
      });

      // The prior conclusion ("the contract version it pins is the
      // signal") was reachable only from a condition phrased as a
      // CONTRACT fact ("guaranteed only against a Backend at or past
      // that change"). Once the condition became a DEPLOYED-RUNTIME fact
      // ("once a deployed Backend's number generator actually reads
      // genre_id"), that conclusion no longer follows -- deploy timing is
      // independent of contract publication, which is the whole point of
      // this description's caveat. The fix drops the claim rather than
      // re-deriving it from a condition it can't support.
      it('does not claim the contract version settles what the deployed generator does', () => {
        expect(description()).not.toMatch(/contract version it pins is the signal/i);
      });

      it('does not name the genre scoping as accomplished fact in the summary', () => {
        const summary = String(operation('/library/artists/{id}/next-release-number', 'get').summary);
        expect(summary).not.toMatch(/BS#\d+|WXYC\/Backend-Service#\d+/);
      });
    });

    describe('DELETE /library/artists/{id} (wxyc-shared#511)', () => {
      function description(): string {
        return String(operation('/library/artists/{id}', 'delete').description);
      }

      // BS#2562 closed 2026-09-20. The description said the opposite of
      // WXYC/Backend-Service#2562's own shipped status at :4561 in the same
      // file -- one declaration asserting the artist delete both shipped
      // and might not exist yet is the self-contradiction class this
      // correction exists to remove, not just staleness.
      it('does not describe WXYC/Backend-Service#2562 as in flight or as authored ahead of the code', () => {
        expect(description()).not.toMatch(/in flight \(open\)/);
        expect(description()).not.toMatch(/not from code that may not exist yet/);
      });

      // RESTORE_PLAN (apps/backend/services/library.service.ts) has no
      // `artists` entry, so an artist batch has no restore plan --
      // `POST /library/deleted/{batchId}/restore` cannot bring one back.
      // Worded as the observable (not restorable), with no status code and
      // no ticket, because a Backend change replacing today's opaque
      // failure with a named refusal is in review right now and this
      // sentence must stay true on both sides of that change landing.
      it('does not claim an artist batch is recoverable via restore', () => {
        expect(description()).not.toMatch(/recoverable via/i);
        expect(description()).toMatch(/not restorable/i);

        // Scoped to the sentence carrying "not restorable" -- the
        // description legitimately carries status codes elsewhere (the
        // four-outcome taxonomy at its end), so a whole-description check
        // would false-positive on the 409/503/404 that already appear
        // there. `.find` can return undefined regardless of the sentence
        // actually being present (per the `toMatch` above), so this
        // throws on absence rather than asserting it, matching this
        // block's own idiom.
        const sentences = description().split(/(?<=\.)\s+/);
        const restorabilitySentence = sentences.find((sentence) => /not restorable/i.test(sentence));
        if (!restorabilitySentence) throw new Error('no "not restorable" sentence found');
        expect(restorabilitySentence).not.toMatch(/\b40\d\b|\b50\d\b/);
      });
    });

    describe('CatalogDeleteBatch (wxyc-shared#510, #511)', () => {
      // The artist delete has shipped and never groups more than one entity
      // -- it refuses outright with a 409 artist_has_releases rather than
      // capturing the artist alongside any release it holds. The old prose
      // described the delete as not yet shipped and as the future call site
      // that groups multiple entities, both false once #2562 shipped. No
      // future call site is on the roadmap either (both capture sites
      // capture exactly one entity, per RESTORE_PLAN's own docstring), so
      // the ordering guarantee must stand on its own rather than promising
      // one.
      it('does not describe the artist delete as unshipped, batch-grouping, or awaiting a future call site', () => {
        const description = String(schema('CatalogDeleteBatch').description);
        expect(description).not.toMatch(/once it ships/);
        expect(description).not.toMatch(/is the first call site that\s+groups\s+more than one entity/);
        expect(description).not.toMatch(/future call site/);
      });

      // `CatalogDeleteBatch` itself has no `entity_kind` property -- it
      // lives on `entities[].entity_kind` -- so telling a consumer the
      // value "depends on the batch's entity_kind" points at a field they
      // cannot see on this object. Pin the corrected pointer as well as the
      // old wrong one's absence.
      it('points the entity_kind dependency at entities[], not at a property CatalogDeleteBatch lacks', () => {
        const description = String(propertyOf('CatalogDeleteBatch', 'unrecoverable')?.description);
        expect(description).not.toMatch(/depends on the batch's `entity_kind`/);
        expect(description).toMatch(/entities\[\]\.entity_kind/);
      });

      // Pin the thing a consumer acts on: `unrecoverable` is declared per
      // entity_kind, not as a constant, and both table lists are spelled
      // out so a librarian reading the archive screen sees the right five
      // names for the batch they're looking at.
      //
      // Both loops are PARAGRAPH-scoped, not description-wide: each table
      // must appear in its OWN kind's paragraph and be ABSENT from the
      // other's, so swapping the two paragraphs wholesale (the library
      // list presented as the artist one and vice versa) fails this test
      // instead of staying green. `library_identity` is checked
      // backtick-anchored (`` `library_identity` ``, not a bare substring)
      // so it cannot be satisfied by `library_identity_source` sitting in
      // the same paragraph.
      //
      // Tamper-verified: reverting the depends-on-entity_kind sentence to
      // "The same list on every batch, not a per-batch computation," and
      // swapping the two paragraphs' contents both make this suite fail.
      it('declares unrecoverable as depending on entity_kind, with each table list named in its own paragraph', () => {
        const description = String(propertyOf('CatalogDeleteBatch', 'unrecoverable')?.description);
        expect(description).not.toMatch(/same list on every batch/);

        const libraryMarker = 'For a `library` batch:';
        const artistMarker = 'For an `artist` batch:';
        const libraryAt = description.indexOf(libraryMarker);
        const artistAt = description.indexOf(artistMarker);
        expect(libraryAt).toBeGreaterThanOrEqual(0);
        expect(artistAt).toBeGreaterThan(libraryAt);

        const libraryParagraph = description.slice(libraryAt, artistAt);
        const artistParagraph = description.slice(artistAt);

        for (const table of [
          'album_metadata',
          'library_identity',
          'library_identity_source',
          'uncovered_release_search_markers',
          'album_review_submissions',
        ]) {
          expect(libraryParagraph).toContain(`\`${table}\``);
          expect(artistParagraph).not.toContain(`\`${table}\``);
        }
        for (const table of [
          'artist_search_alias',
          'artist_similar_artists',
          'artist_station_plays',
          'concerts',
          'concert_performers',
        ]) {
          expect(artistParagraph).toContain(`\`${table}\``);
          expect(libraryParagraph).not.toContain(`\`${table}\``);
        }
      });
    });

    describe('GET /library/deleted (wxyc-shared#510)', () => {
      it('does not hedge the artist delete as unshipped', () => {
        const description = String(operation('/library/deleted', 'get').description);
        expect(description).not.toMatch(/once it ships/);
      });
    });

    describe('GET /library/{id}/flowsheet-play-counts', () => {
      // `type: integer` on the path parameter is wider than int4, so the
      // handler 400s on a value it permits. Undeclared, the delete
      // confirmation screen -- the one caller -- surfaces that as an
      // unexpected-response error rather than a bad request.
      it('declares the 400 its id parser can raise', () => {
        const responses = operation('/library/{id}/flowsheet-play-counts', 'get').responses as Record<
          string,
          unknown
        >;
        expect(Object.keys(responses).sort()).toEqual(['200', '400', '404']);
      });
    });

    // WXYC/wxyc-shared#512: four wire elements the handlers already serve
    // that the contract omitted -- verified against the merged
    // Backend-Service handlers, not this ticket's prose.
    describe('CatalogDeleteBatch.restorable (wxyc-shared#512)', () => {
      // The handler computes
      //   parsed.length > 0 && parsed.every(({ row, envelope }) =>
      //     isRestorableEntityKind(row.entity_kind) && envelope.entity.row !== null)
      // so there are THREE ways this reads false -- an unplannable kind, a
      // captured envelope missing its row, and a batch whose rows read back
      // empty (the deliberately non-vacuous length guard) -- and the restore
      // screen that consumes the field needs all three. A kind-only claim
      // tells that screen a `library` batch always reads true, so a false
      // looks like a server bug rather than a corrupt capture.
      it('describes every false-condition the handler computes, not entity_kind alone', () => {
        expect(requiredKeysOf('CatalogDeleteBatch')).toContain('restorable');
        expect(propertyOf('CatalogDeleteBatch', 'restorable')?.type).toBe('boolean');

        const description = String(propertyOf('CatalogDeleteBatch', 'restorable')?.description);
        expect(description).toMatch(/no replay plan/i);
        expect(description).toMatch(/envelope is missing its row/i);
        expect(description).toMatch(/read back empty/i);
        expect(description).toMatch(/every one of them/i);
      });

      // The true side. Because the envelope half is evaluated HERE, at
      // listing time, against an immutable capture, `true` cannot go on to
      // hit the corrupt-envelope failure -- so naming that as the residual
      // risk is backwards. What a restorable batch can still answer is the
      // three outcomes below, all of which a caller must handle.
      //
      // The restore-success negative is deliberately NOT keyed to one
      // phrasing. The assertion this replaces read
      // `not.toMatch(/this row will restore/i)`, a phrase that only ever
      // existed in the Backend docstring, so "pressing Restore on it will
      // succeed" -- an explicit success promise -- passed it. Instead: find
      // every clause that claims a restore will restore or succeed, and
      // require each one to be the negated disclaimer.
      it('promises no restore success, and names the outcomes a restorable batch can still answer', () => {
        const description = String(propertyOf('CatalogDeleteBatch', 'restorable')?.description);

        const successClaims = description.match(/[^.;]*\bwill (?:restore|succeed)\b[^.;]*/gi) ?? [];
        expect(successClaims.length).toBeGreaterThan(0);
        for (const claim of successClaims) {
          expect(claim).toMatch(/is not a promise/i);
        }

        for (const outcome of ['already_restored', 'resolution_required', 'lock_unavailable']) {
          expect(description).toContain(`\`${outcome}\``);
        }
      });
    });

    describe('UpdateAlbumRequest.code_number (wxyc-shared#512)', () => {
      // This field sat eight thousand lines from the 409 the same PR
      // declared, still saying flatly that nothing is checked and that the
      // 409 mapping is future work on WXYC/Backend-Service#2033. A reader of
      // the field description concluded the PATCH never refuses on a slot
      // collision and wrote no handler for the 409. Backend's app.yaml
      // carries the reconciling clause on this very field; this asserts
      // api.yaml does too.
      it('names the genre-change collision check its own 409 enforces', () => {
        const description = String(propertyOf('UpdateAlbumRequest', 'code_number')?.description);
        expect(description).toContain('library_slot_conflict');
        expect(description).toMatch(/changes `genre_id`/);
        expect(description).not.toMatch(/no application-level collision check,\s*same as the create side/i);
      });
    });

    describe('RestoreUnrestorableKindRefusal (wxyc-shared#512)', () => {
      // The handler sends exactly one reason literal for this branch --
      // a wider enum would accept refusals the endpoint never emits.
      it('requires message, reason and entity_kind, with reason pinned to the single literal the handler sends', () => {
        expect(requiredKeysOf('RestoreUnrestorableKindRefusal').sort()).toEqual(
          ['entity_kind', 'message', 'reason'].sort()
        );
        expect(propertyOf('RestoreUnrestorableKindRefusal', 'reason')?.enum).toEqual(['unrestorable_kind']);
      });
    });

    describe('PATCH /library/{id} (wxyc-shared#512)', () => {
      // The handler throws WxycError(..., 409, { code: 'library_slot_conflict' }),
      // and toApiErrorResponse() projects that as { message, code } -- the
      // existing ApiErrorResponse shape, so this is a response addition,
      // not a new schema.
      it('declares a 409 referencing the existing ApiErrorResponse', () => {
        const schemaRef = responseSchema('/library/{id}', 'patch', '409');
        expect(schemaRef.$ref).toBe('#/components/schemas/ApiErrorResponse');
      });

      // Backend's app.yaml declares this operation's 400 and the handler
      // raises one on every field-validation path, while the sibling
      // `DELETE /library/{id}` already declares its own. Undeclared, the
      // app.yaml/api.yaml structural drift gate stays red on this operation
      // for a missing status rather than a disagreeing one. Same
      // response-key-set shape as the `flowsheet-play-counts` test above.
      it('declares the 400 every field-validation path raises', () => {
        const responses = operation('/library/{id}', 'patch').responses as Record<string, unknown>;
        expect(Object.keys(responses).sort()).toEqual(['200', '400', '404', '409']);
        expect(responseSchema('/library/{id}', 'patch', '400').$ref).toBe(
          '#/components/schemas/ApiErrorResponse'
        );
      });
    });

    describe('GET /library/artists/{id}/next-release-number genre_id (wxyc-shared#512)', () => {
      // The handler validates via parseCodeQueryInt(..., 1), which 400s
      // below 1 AND above INT4_MAX; Backend's app.yaml declares both bounds,
      // and so does the sibling /library/artists/by-code's genre_id -- the
      // precedent this change cites. With only the minimum declared, a
      // generated client can send genre_id=3000000000, expect the 200 the
      // contract promises, and get a 400.
      it('declares both handler bounds on genre_id, not just the minimum', () => {
        const parameters = operation('/library/artists/{id}/next-release-number', 'get').parameters as Array<
          Record<string, unknown>
        >;
        const genre = parameters.find((parameter) => parameter.name === 'genre_id');
        if (!genre) throw new Error('no genre_id parameter found');
        const schemaOf = genre.schema as Record<string, unknown>;
        expect(schemaOf.minimum).toBe(1);
        expect(schemaOf.maximum).toBe(2147483647);
      });
    });
  });

  // The contract's first per-listener-keyed persistence (wxyc-shared#522).
  // Declared ahead of their Backend-Service implementation
  // (Backend-Service#2665, #2667), so these assertions are the only thing
  // proving the shape before either handler exists.
  describe('Listener request replies (DJ replies)', () => {
    function operation(path: string, method: string): Record<string, unknown> {
      const item = (spec.paths as Record<string, Record<string, unknown> | undefined>)[path];
      if (!item) throw new Error(`api.yaml declares no path ${path}`);
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) throw new Error(`api.yaml declares no ${method.toUpperCase()} on ${path}`);
      return op;
    }

    describe('GET /listener/request-replies', () => {
      const get = () => operation('/listener/request-replies', 'get');

      it('is served by backend-service', () => {
        expect(get()['x-wxyc-service']).toBe('backend-service');
      });

      it('declares a request_ids query parameter whose description mentions the 20-id cap', () => {
        const parameters = get().parameters as Array<Record<string, unknown>>;
        const requestIds = parameters.find((parameter) => parameter.name === 'request_ids');
        if (!requestIds) throw new Error('no request_ids parameter found');
        expect(requestIds.description).toMatch(/20/);
      });

      it('declares no operation-level security override, inheriting the document-level BearerAuth', () => {
        expect((get() as { security?: unknown }).security).toBeUndefined();
      });

      it('states plainly that no device-fingerprint header is accepted', () => {
        expect(get().description).toMatch(/no .*fingerprint/i);
      });
    });

    describe('PUT and DELETE /listener/push-token', () => {
      it.each(['put', 'delete'] as const)('%s is served by backend-service and requires PushTokenRegistration', (method) => {
        const op = operation('/listener/push-token', method);
        expect(op['x-wxyc-service']).toBe('backend-service');
        const requestBody = op.requestBody as { required?: boolean; content?: Record<string, { schema?: { $ref?: string } }> };
        expect(requestBody.required).toBe(true);
        expect(requestBody.content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/PushTokenRegistration'
        );
        const responses = op.responses as Record<string, unknown>;
        expect(responses['204']).toBeDefined();
      });
    });

    describe('PushTokenRegistration', () => {
      it('requires provider, token, environment, bundle_id in that order', () => {
        expect(requiredKeysOf('PushTokenRegistration')).toEqual([
          'provider',
          'token',
          'environment',
          'bundle_id',
        ]);
      });

      it('constrains provider and environment to their closed enums', () => {
        expect(propertyOf('PushTokenRegistration', 'provider')?.enum).toEqual(['apns', 'fcm']);
        expect(propertyOf('PushTokenRegistration', 'environment')?.enum).toEqual(['production', 'sandbox']);
      });
    });

    describe('ListenerRequestReply', () => {
      it('requires request_id, reply_id, body, sent_at but not on_air_dj_name', () => {
        const required = requiredKeysOf('ListenerRequestReply');
        expect(required).toEqual(expect.arrayContaining(['request_id', 'reply_id', 'body', 'sent_at']));
        expect(required).not.toContain('on_air_dj_name');
      });

      it('bounds body to between 1 and 500 characters', () => {
        expect(propertyOf('ListenerRequestReply', 'body')?.minLength).toBe(1);
        expect(propertyOf('ListenerRequestReply', 'body')?.maxLength).toBe(500);
      });

      it('formats request_id and reply_id as uuid', () => {
        expect(propertyOf('ListenerRequestReply', 'request_id')?.format).toBe('uuid');
        expect(propertyOf('ListenerRequestReply', 'reply_id')?.format).toBe('uuid');
      });
    });

    describe('ListenerRequestRepliesResponse', () => {
      it('declares replies as an array of ListenerRequestReply', () => {
        const replies = propertyOf('ListenerRequestRepliesResponse', 'replies') as
          | { items?: { $ref?: string } }
          | undefined;
        expect(replies?.items?.$ref).toBe('#/components/schemas/ListenerRequestReply');
      });
    });

    describe('SongLikeDelta cross-reference amendment', () => {
      it('no longer claims no listener key exists anywhere in this contract, and points at the departure', () => {
        const description = spec.components.schemas.SongLikeDelta as { description?: string };
        expect(description.description).not.toMatch(/anywhere in this contract/);
        expect(description.description).toMatch(/listener request replies/i);
      });
    });
  });
});
