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
  // and either branch may be a `$ref` rather than an inline object —
  // `FlowsheetEntryResponse` and `FlowsheetRangeEntry` both share their field
  // block that way, so that the two can never drift apart. A walk that only
  // reads inline `properties`/`required` off the immediate branches silently
  // finds nothing on those, which reads as "the field isn't declared" rather
  // than "the helper can't see it". These two follow `$ref` instead.
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
      expect(spec.info.version).toBe('1.48.0');
    });

    it('should have components section', () => {
      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
    });

    it('should have paths section', () => {
      expect(spec.paths).toBeDefined();
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

    it('should define OnAirStatusResponse', () => {
      expect(spec.components.schemas.OnAirStatusResponse).toBeDefined();
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
        return schema.properties.id;
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

      it('declares intent as an optional two-value enum', () => {
        const intent = joinProperties().intent;
        expect(intent).toBeDefined();
        expect(intent?.type).toBe('string');
        expect(intent?.enum).toEqual(['join', 'takeover']);
      });

      it('does not give intent a default — an absent field means "the caller did not choose"', () => {
        // A `default:` here would let a generator materialize one of the two
        // decisions on a client that never made it, which is the silent
        // co-host bug wearing a different hat. Absence is its own state and
        // the server answers it with the 409 below.
        expect(joinProperties().intent).not.toHaveProperty('default');
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

      it('documents a 409 that $refs the shared ApiErrorResponse', () => {
        const conflict = joinResponse('409');
        expect(conflict).toBeDefined();
        expect(conflict?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ApiErrorResponse');
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

      it('warns that details.show.dj_name is nullable', () => {
        // resolveDjNameForShow returns string | null, and null is the COMMON
        // case for the abandoned shows this handshake exists to unstick.
        // A prompt that interpolates it unguarded renders "null is on air".
        const conflict = String(joinResponse('409')?.description ?? '');
        expect(conflict).toMatch(/`dj_name` is nullable/);
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
          items: { $ref: '#/components/schemas/FlowsheetRangeEntry' },
        });
        expect(propertyOf('FlowsheetRangeResponse', 'shows')).toMatchObject({
          items: { $ref: '#/components/schemas/FlowsheetRangeShow' },
        });
      });

      // 20 of 2,619,011 rows have no linked show and Phase 0 decided against a
      // backfill, so the null reaches the wire. Both consumers that group by
      // show are the likely defect site.
      it('declares entries[].show_id nullable, present, and names the unattributed case', () => {
        const showId = propertyOf('FlowsheetRangeEntry', 'show_id');
        expect(showId?.type).toBe('integer');
        expect(showId?.nullable).toBe(true);
        expect(String(showId?.description)).toMatch(/unattributed/i);
        // Nullable value, still-present key — the `--strict-nullable` idiom.
        expect(requiredKeysOf('FlowsheetRangeEntry')).toContain('show_id');
      });

      // iOS V2 decodes this endpoint and GET /flowsheet with one decoder
      // (tubafrenzy-decommissioning plan §2.5, consumer #3), so the two entry
      // shapes may differ in show_id's nullability and in nothing else. Both
      // compose FlowsheetEntryFields to make that structural; this pins it.
      it('carries the exact field set of FlowsheetEntryResponse', () => {
        function fieldNames(schemaName: string): string[] {
          function walk(node: unknown): string[] {
            const schema = deref(node);
            if (!schema) return [];
            return [
              ...Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}),
              ...((schema.allOf as unknown[] | undefined) ?? []).flatMap(walk),
            ];
          }
          return [...new Set(walk(spec.components.schemas[schemaName]))].sort();
        }
        expect(fieldNames('FlowsheetRangeEntry')).toEqual(fieldNames('FlowsheetEntryResponse'));
        expect(requiredKeysOf('FlowsheetRangeEntry').sort()).toEqual(
          requiredKeysOf('FlowsheetEntryResponse').sort()
        );
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

    it('should define TrackSearchResult', () => {
      expect(spec.components.schemas.TrackSearchResult).toBeDefined();
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

    it('defines UpdateAlbumRequest matching BS wire format exactly: 10 fields, all optional, no `required` list', () => {
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
          'disc_quantity',
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

    it('UpdateAlbumRequest omits artist_name and code_number (server-derived; UPDATABLE_ALBUM_FIELDS never reads them from the body)', () => {
      const schema = spec.components.schemas.UpdateAlbumRequest as Schema;
      expect(schema.properties?.artist_name).toBeUndefined();
      expect(schema.properties?.code_number).toBeUndefined();
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
        expect(albumDetail.properties.legacy_release_id.type).toBe('integer');
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
    ];

    it('defines CatalogExportRow with exactly the 19 shipped fields', () => {
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
      expect(spec.components.schemas.DJPlaylistsResponse).toBeDefined();
    });

    it('should define BinEntry', () => {
      expect(spec.components.schemas.BinEntry).toBeDefined();
    });

    it('should define Playlist', () => {
      expect(spec.components.schemas.Playlist).toBeDefined();
    });

    it('should define PlaylistWithEntries', () => {
      expect(spec.components.schemas.PlaylistWithEntries).toBeDefined();
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

    it('should define SpecialtyShow', () => {
      expect(spec.components.schemas.SpecialtyShow).toBeDefined();
    });
  });

  describe('Request Line Schemas', () => {
    it('should define SongRequest', () => {
      expect(spec.components.schemas.SongRequest).toBeDefined();
    });

    it('should define EnhancedRequest', () => {
      expect(spec.components.schemas.EnhancedRequest).toBeDefined();
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

    it('should define DiscogsRelease', () => {
      expect(spec.components.schemas.DiscogsRelease).toBeDefined();
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
      expect(schema.properties.position.type).toBe('string');
      expect(schema.properties.title.type).toBe('string');
      expect(schema.properties.duration.type).toBe('string');
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
      expect(schema.properties.discogs_artist_id.type).toBe('integer');
      expect(schema.properties.discogs_artist_id.nullable).toBe(true);
      expect(schema.properties.musicbrainz_artist_id.type).toBe('string');
      expect(schema.properties.musicbrainz_artist_id.nullable).toBe(true);
      expect(schema.properties.wikidata_qid.type).toBe('string');
      expect(schema.properties.wikidata_qid.nullable).toBe(true);
      expect(schema.properties.spotify_artist_id.type).toBe('string');
      expect(schema.properties.spotify_artist_id.nullable).toBe(true);
      expect(schema.properties.apple_music_artist_id.type).toBe('string');
      expect(schema.properties.apple_music_artist_id.nullable).toBe(true);
      expect(schema.properties.bandcamp_id.type).toBe('string');
      expect(schema.properties.bandcamp_id.nullable).toBe(true);
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
      expect(schema.properties.reconciled_identity.$ref).toBe(
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
      expect(schema.properties.include_identity.type).toBe('boolean');
      expect(schema.properties.include_identity.default).toBe(false);
      // Not required — v1 consumers continue to omit it.
      expect(schema.required ?? []).not.toContain('include_identity');
    });

    it('should add api_version to LookupResponse with enum [2] (absent for v1 shape)', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { type?: string; enum?: number[] }>;
        required?: string[];
      };
      expect(schema.properties.api_version).toBeDefined();
      expect(schema.properties.api_version.type).toBe('integer');
      expect(schema.properties.api_version.enum).toEqual([2]);
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
      expect(identity.$ref).toBe('#/components/schemas/LookupIdentityBlock');
      expect(identity.nullable).toBeUndefined();
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
      expect(schema.properties.api_version.nullable).toBe(true);
    });

    it('mandates a value-equality check on api_version and forbids a presence check', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.api_version.description ?? '';
      expect(description).toMatch(/MUST test for the value `2`/);
      expect(description).toMatch(/must never test for key presence/);
    });

    it('explains why the value probe is required: absent, null, and an unimplemented producer must all read "not supported"', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.api_version.description ?? '';
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
      const description = schema.properties.include_identity.description ?? '';
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
      const description = schema.properties.include_identity.description ?? '';
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
      expect(schema.properties.source.$ref).toBe('#/components/schemas/IdentitySource');
      // external_id, method, confidence, reason all nullable so a skipped
      // leg can NULL them.
      expect(schema.properties.external_id.nullable).toBe(true);
      expect(schema.properties.confidence.nullable).toBe(true);
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
      expect(schema.properties.extended.type).toBe('boolean');
      // Intentionally omit `default:` so openapi-typescript emits the field
      // as optional (`extended?: boolean`) rather than required. Existing
      // consumers (LML/BS/iOS/dj-site) keep compiling without passing it.
      expect(schema.properties.extended.default).toBeUndefined();
      // Not required — non-iOS consumers continue to omit it.
      expect(schema.required ?? []).not.toContain('extended');
    });

    it('should define LookupRequest.warm_cache as an optional boolean with no default', () => {
      const schema = spec.components.schemas.LookupRequest as {
        properties: Record<string, SchemaProp>;
        required?: string[];
      };
      expect(schema.properties.warm_cache).toBeDefined();
      expect(schema.properties.warm_cache.type).toBe('boolean');
      // Same rationale as `extended` — see comment above.
      expect(schema.properties.warm_cache.default).toBeUndefined();
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
      expect(prop.type).toBe('string');
      expect(prop.format).toBe('date-time');
      expect(prop.nullable).toBe(true);
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
        expect(schema.properties[name].nullable).toBe(true);
      };

      optional('discogs_artist_id');
      expect(schema.properties.discogs_artist_id.type).toBe('integer');

      optional('tracklist');
      expect(schema.properties.tracklist.type).toBe('array');
      expect(schema.properties.tracklist.items?.$ref).toBe(
        '#/components/schemas/DiscogsTrackItem',
      );

      optional('genres');
      expect(schema.properties.genres.type).toBe('array');
      expect(schema.properties.genres.items?.type).toBe('string');

      optional('styles');
      expect(schema.properties.styles.type).toBe('array');
      expect(schema.properties.styles.items?.type).toBe('string');

      optional('label');
      expect(schema.properties.label.type).toBe('string');

      optional('full_release_date');
      expect(schema.properties.full_release_date.type).toBe('string');

      optional('artist_image_url');
      expect(schema.properties.artist_image_url.type).toBe('string');

      // Field name matches DiscogsArtistDetails.profile_tokens so iOS / dj-site
      // can share rendering code across the two payloads.
      optional('profile_tokens');
      expect(schema.properties.profile_tokens.type).toBe('array');
      expect(schema.properties.profile_tokens.items?.$ref).toBe(
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
      expect(prop.type).toBe('integer');
      expect(prop.nullable).toBe(true);
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
      expect(prop.type).toBe('integer');
      expect(prop.nullable).toBe(true);
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
      expect(schema.properties.names.type).toBe('array');
      expect(schema.properties.names.items?.type).toBe('string');
      expect(schema.properties.provenance.enum).toEqual(['track', 'release']);
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
      expect(schema.properties.writer_credits.$ref).toBe(
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
      expect(schema.properties.timeout.type).toBe('boolean');
      expect(schema.properties.timeout.default).toBe(false);
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
      expect(schema.properties.degraded.type).toBe('boolean');
      expect(schema.properties.degraded.default).toBe(false);
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
      expect(schema.properties.degraded_reason.type).toBe('string');
      expect(schema.properties.degraded_reason.enum).toEqual([
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
      const description = schema.properties.matched_via.description ?? '';
      expect(description).toContain('SONG_AS_TRACK');
      expect(description).toContain('multi-location union');
      expect(description).toContain('discogs_release');
    });

    it('should leave the AlbumSearchResult.matched_via description untouched (BS catalog search, not the location union)', () => {
      const schema = spec.components.schemas.AlbumSearchResult as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.matched_via.description ?? '';
      expect(description).toContain("Backend's catalog `/library/` search");
      expect(description).not.toContain('multi-location union');
    });

    it('should leave the LibrarySearchItem.matched_via description untouched (LML catalog search, not the location union)', () => {
      const schema = spec.components.schemas.LibrarySearchItem as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.matched_via.description ?? '';
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
      ((spec.paths[path] as Record<string, Op>)[method].responses ?? {})['200']?.content?.[
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
              .properties.genre_name,
        },
        {
          label: 'ArtistWithGenre',
          get: () =>
            (
              spec.components.schemas.ArtistWithGenre as {
                allOf: Array<{ properties?: Record<string, { type?: string }> }>;
              }
            ).allOf.find((m) => m.properties?.genre_name)!.properties!.genre_name,
        },
        {
          label: 'AlbumSearchResult',
          get: () =>
            (
              spec.components.schemas.AlbumSearchResult as {
                properties: Record<string, { type?: string }>;
              }
            ).properties.genre_name,
        },
        {
          label: 'AlbumDetail',
          get: () =>
            (spec.components.schemas.AlbumDetail as { properties: Record<string, { type?: string }> })
              .properties.genre_name,
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
      expect(schema.properties.genres.type).toBe('array');
      expect(schema.properties.styles).toBeDefined();
      expect(schema.properties.styles.type).toBe('array');
      expect(schema.properties.label).toBeDefined();
      expect(schema.properties.label.type).toBe('string');
      expect(schema.properties.discogsArtistId).toBeDefined();
      expect(schema.properties.discogsArtistId.type).toBe('integer');
      expect(schema.properties.fullReleaseDate).toBeDefined();
      expect(schema.properties.fullReleaseDate.type).toBe('string');
      expect(schema.properties.tracklist).toBeDefined();
      expect(schema.properties.tracklist.type).toBe('array');
      expect(schema.properties.tracklist.items?.$ref).toBe('#/components/schemas/TrackListItem');
    });

    it('should define ArtistMetadataResponse with imageUrl', () => {
      const schema = spec.components.schemas.ArtistMetadataResponse as {
        properties: Record<string, { type: string }>;
      };
      expect(schema.properties.imageUrl).toBeDefined();
      expect(schema.properties.imageUrl.type).toBe('string');
    });

    it('should define ArtistMetadataResponse.bioTokens as a nullable array of DiscogsResolvedToken (#251)', () => {
      const schema = spec.components.schemas.ArtistMetadataResponse as {
        properties: Record<string, { type?: string; nullable?: boolean; items?: { $ref?: string } }>;
        required?: string[];
      };
      expect(schema.properties.bioTokens).toBeDefined();
      expect(schema.properties.bioTokens.type).toBe('array');
      // The backend emits an explicit `?? null` for this field.
      expect(schema.properties.bioTokens.nullable).toBe(true);
      // Reuses the existing token schema (pass-through of
      // DiscogsArtistDetails.profile_tokens) — no parallel token shape.
      expect(schema.properties.bioTokens.items?.$ref).toBe(
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
      expect(field.type).toBe('string');
    });

    it('declares donateEnabled as a boolean', () => {
      const field = appConfig().properties.donateEnabled;
      expect(field).toBeDefined();
      expect(field.type).toBe('boolean');
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
      expect(field.description ?? '').toMatch(/empty string/i);
      expect(field.nullable).toBeUndefined();
      expect(field).not.toHaveProperty('format');
    });

    // The two env vars are independent on one deploy, so enabled-with-no-URL
    // is reachable. iOS resolves it via a fallback ladder that always ends at
    // a compile-time URL, but nothing structural stops another client from
    // rendering an enabled button with no destination — the contract has to
    // say which field decides what.
    it('resolves the enabled-with-unusable-url state rather than leaving it to each client', () => {
      const description = appConfig().properties.donateUrl.description ?? '';
      expect(description).toMatch(/MUST NOT render/);
      expect(description).toMatch(/independent variables/i);
    });

    // `false` hides the entry point; absent does NOT mean hidden. The
    // dark-ship guarantee is carried by each client's own bootstrap default,
    // not by omission, so the description must not promise hide-on-absent —
    // the sole frozen consumer resolves absent to *visible*
    // (`donateEnabled ?? true` in wxyc-ios-64#913).
    it('documents donateEnabled as hide-on-false, client-default-on-absent, and absence as explicitly not a kill switch', () => {
      const description = appConfig().properties.donateEnabled.description ?? '';
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
      const description = appConfig().properties.donateEnabled.description ?? '';
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
      expect(appConfig().properties.donateEnabled.description ?? '').toMatch(
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
      expect(schema.properties.type.enum).toEqual(['update']);
      // Payload is the full flowsheet row — pinned by
      // CONTRACTS.LIVE_FS_UPDATE_INCLUDES_FULL_ROW.
      expect(schema.properties.payload.$ref).toBe('#/components/schemas/FlowsheetEntryResponse');
    });

    it('should define LiveFsRefetchEvent with the {type, payload, timestamp} envelope', () => {
      const schema = spec.components.schemas.LiveFsRefetchEvent as {
        type: string;
        required: string[];
        properties: Record<string, { enum?: string[] }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['type', 'payload', 'timestamp']);
      expect(schema.properties.type.enum).toEqual(['refetch']);
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
      expect(schema.properties.type.enum).toEqual(['insert']);
      // Carries the full newly-inserted flowsheet row — same payload shape as
      // LiveFsUpdateEvent, valid pre-enrichment (metadata_status 'pending',
      // enrichment fields nullable on FlowsheetEntryResponse).
      expect(schema.properties.payload.$ref).toBe('#/components/schemas/FlowsheetEntryResponse');
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
        expect(prop.$ref).toBe('#/components/schemas/StreamingResolutionStatus');
        // Optional but NOT nullable: never-consulted is encoded solely by key
        // omission; a consulted-but-absent service is the `absent` verdict — so
        // `null` would be a redundant second encoding of never-consulted.
        expect(prop.nullable).toBeUndefined();
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
      expect(schema.properties.streaming_status.nullable).toBe(true);
      expect(schema.properties.streaming_status.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/StreamingResolution',
      );
      // Additive: not required, so existing LML/BS consumers are unaffected and a
      // null/omitted object means "no per-service status resolved on this path"
      // (e.g. an LML predating the producer rollout). Does not change the meaning
      // of the sibling `*_url` fields — it only annotates why a url is null.
      expect(schema.required ?? []).not.toContain('streaming_status');
    });
  });

  describe('Streaming Check (LML#376 partial-error semantics)', () => {
    it('should define StreamingCheckResponse.errored_sources as an optional string[]', () => {
      const schema = spec.components.schemas.StreamingCheckResponse as {
        properties: Record<string, { type?: string; items?: { type?: string } }>;
        required?: string[];
      };
      expect(schema.properties.errored_sources).toBeDefined();
      expect(schema.properties.errored_sources.type).toBe('array');
      expect(schema.properties.errored_sources.items?.type).toBe('string');
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
      expect(schema.properties.source.$ref).toBe('#/components/schemas/ArtistSearchAliasSource');
      expect(schema.properties.method.$ref).toBe('#/components/schemas/ArtistSearchAliasMethod');
      expect(schema.properties.variant.type).toBe('string');
      // related_external_id / related_name / active are nullable optionals — only set for some kinds.
      expect(schema.properties.related_external_id.nullable).toBe(true);
      expect(schema.properties.related_name.nullable).toBe(true);
      expect(schema.properties.active.nullable).toBe(true);
      // Confidence in [0, 1].
      expect(schema.properties.confidence.type).toBe('number');
      expect(schema.properties.confidence.minimum).toBe(0);
      expect(schema.properties.confidence.maximum).toBe(1);
    });

    it('should define ArtistSearchAliasesResult requiring name + variants + sources_present', () => {
      const schema = spec.components.schemas.ArtistSearchAliasesResult as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string } }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['name', 'variants', 'sources_present']);
      expect(schema.properties.variants.type).toBe('array');
      expect(schema.properties.variants.items?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasVariant',
      );
      // sources_present is the reconcile-scope tag list. Empty array means
      // "no leg ran" — BS leaves cached rows alone.
      expect(schema.properties.sources_present.type).toBe('array');
      expect(schema.properties.sources_present.items?.$ref).toBe(
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
      expect(schema.properties.names.type).toBe('array');
      expect(schema.properties.names.minItems).toBe(1);
      expect(schema.properties.names.maxItems).toBe(1000);
      expect(schema.properties.names.items?.type).toBe('string');
    });

    it('should define ArtistSearchAliasesBulkResponse requiring artists + missing', () => {
      const schema = spec.components.schemas.ArtistSearchAliasesBulkResponse as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string; type?: string }; $ref?: string }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['artists', 'missing']);
      expect(schema.properties.artists.type).toBe('array');
      expect(schema.properties.artists.items?.$ref).toBe(
        '#/components/schemas/ArtistSearchAliasesResult',
      );
      expect(schema.properties.missing.type).toBe('array');
      expect(schema.properties.missing.items?.type).toBe('string');
      // cache_stats is optional — mirrors the LML lookup family convention.
      expect(schema.properties.cache_stats.$ref).toBe('#/components/schemas/CacheStats');
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
      expect(schema.properties.matched_variant.type).toBe('string');
      expect(schema.properties.source.$ref).toBe('#/components/schemas/ArtistSearchAliasSource');
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
        expect(schema.properties.matched_via_alias.type).toBe('array');
        expect(schema.properties.matched_via_alias.items?.$ref).toBe(
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
      expect(schema.properties.name.type).toBe('string');
      // Verdict fields are optional: exactly one of discogs_artist_id
      // (resolved) or unresolved_reason (unresolved) appears per result.
      // method and unresolved_reason are allOf-wrapped so their presence
      // rules survive codegen ($ref sibling keys are dropped in 3.0).
      expect(schema.properties.discogs_artist_id.type).toBe('integer');
      expect(schema.properties.canonical_name.type).toBe('string');
      expect(schema.properties.method.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/ArtistResolveMethod',
      );
      expect(schema.properties.unresolved_reason.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/ArtistResolveUnresolvedReason',
      );
      // cache_corroboration is present on BOTH verdict kinds (per-leg yield
      // telemetry), so it is required — empty array when no leg matched. A
      // leg either yielded or didn't, so entries are unique (and adding
      // uniqueItems later would flip swift5 codegen Array→Set, a breaking
      // change that is free to avoid now).
      expect(schema.properties.cache_corroboration.type).toBe('array');
      expect(schema.properties.cache_corroboration.uniqueItems).toBe(true);
      expect(schema.properties.cache_corroboration.items?.$ref).toBe(
        '#/components/schemas/ArtistResolveCacheLeg',
      );
      // candidate_count: always serialized per the description's wire pin;
      // null means "API tier did not run," never zero. Optional-in-schema
      // only because datamodel-codegen's default flags (LML's generator)
      // would type required+nullable as non-nullable int, rejecting null.
      expect(schema.properties.candidate_count.type).toBe('integer');
      expect(schema.properties.candidate_count.nullable).toBe(true);
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
      expect(schema.properties.names.type).toBe('array');
      expect(schema.properties.names.minItems).toBe(1);
      // 25, not 1000: a fully-escalating batch costs ~25 live Discogs API
      // calls (~30s at the shared 50/min budget); callers page.
      expect(schema.properties.names.maxItems).toBe(25);
      // Per-item bounds: names feed live Discogs querystrings and verbatim
      // entity.identity mint keys, so empty and unbounded strings are
      // rejected at the contract.
      expect(schema.properties.names.items?.type).toBe('string');
      expect(schema.properties.names.items?.minLength).toBe(1);
      expect(schema.properties.names.items?.maxLength).toBe(255);
      expect(schema.properties.dry_run.type).toBe('boolean');
      expect(schema.properties.dry_run.default).toBe(false);
    });

    it('should define ArtistResolveBulkResponse requiring index-aligned results', () => {
      const schema = spec.components.schemas.ArtistResolveBulkResponse as {
        required: string[];
        properties: Record<string, { type?: string; items?: { $ref?: string } }>;
      };
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['results']);
      expect(schema.properties.results.type).toBe('array');
      expect(schema.properties.results.items?.$ref).toBe(
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
      const example = (spec.components.schemas.BulkResolveLibrariesResponse as Schema).example as
        | Record<string, unknown>
        | undefined;
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
      expect(schema.properties.status.type).toBe('string');
      expect(schema.properties.status.enum).toEqual(['healthy', 'degraded', 'unhealthy']);
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
      expect(base.$ref).toBe('#/components/schemas/HealthCheckResponse');

      expect(extension.type).toBe('object');
      expect(extension.required).toEqual(['services']);
      const services = extension.properties?.services;
      expect(services?.type).toBe('object');
      expect(services?.additionalProperties?.type).toBe('string');
      expect(services?.additionalProperties?.enum).toEqual(['ok', 'unavailable', 'timeout']);
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
      expect(r['400'].content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
      expect(r['500'].content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
    });

    it('models approve/deny errors per status (400 + 401 + 403 + 429); the three plugin statuses are DeviceAuthActionError', () => {
      for (const route of ['/auth/device/approve', '/auth/device/deny']) {
        const r = (spec.paths[route] as { post: Operation }).post.responses!;
        expect(Object.keys(r).sort(), route).toEqual(['200', '400', '401', '403', '429']);
        for (const code of ['400', '401', '403']) {
          expect(r[code].content?.['application/json']?.schema?.$ref, `${route} ${code}`).toBe(
            '#/components/schemas/DeviceAuthActionError'
          );
        }
      }
    });

    it('models /device/code and GET /device errors as 400 + 429, each with its own 400 envelope', () => {
      const codeR = (spec.paths['/auth/device/code'] as { post: Operation }).post.responses!;
      expect(Object.keys(codeR).sort()).toEqual(['200', '400', '429']);
      expect(codeR['400'].content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DeviceAuthCodeError'
      );
      const verifyR = (spec.paths['/auth/device'] as { get: Operation }).get.responses!;
      expect(Object.keys(verifyR).sort()).toEqual(['200', '400', '429']);
      expect(verifyR['400'].content?.['application/json']?.schema?.$ref).toBe(
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
        expect(r.content?.['application/json']?.schema?.$ref, route).toBe(
          '#/components/schemas/AuthPlainErrorResponse'
        );
        expect(Object.keys(r.headers ?? {}), route).toEqual(['Retry-After']);
      }

      const betterAuthLimited: Array<[string, 'get' | 'post']> = [
        ['/auth/device/token', 'post'],
        ['/auth/device', 'get'],
      ];
      for (const [route, method] of betterAuthLimited) {
        const r = (spec.paths[route] as Record<string, Operation>)[method].responses!['429'];
        expect(r.content?.['application/json']?.schema?.$ref, route).toBe(
          '#/components/schemas/AuthRateLimitedResponse'
        );
        expect(Object.keys(r.headers ?? {}), route).toEqual(['X-Retry-After']);
      }
    });

    it('wires each endpoint 200 success response to its own response schema', () => {
      const okRef = (op: Operation) => op.responses!['200'].content?.['application/json']?.schema?.$ref;
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
      const ba = JSON.parse(
        readFileSync(join(__dirname, '..', 'node_modules', 'better-auth', 'package.json'), 'utf-8')
      ) as { version: string };
      expect(ba.version).toBe('1.7.1');
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
});
