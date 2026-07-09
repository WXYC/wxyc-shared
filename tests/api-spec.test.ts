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

  beforeAll(() => {
    const specPath = join(__dirname, '..', 'api.yaml');
    const content = readFileSync(specPath, 'utf-8');
    spec = parse(content) as OpenAPISpec;
  });

  describe('Structure', () => {
    it('should be valid OpenAPI 3.0', () => {
      expect(spec.openapi).toMatch(/^3\.0/);
    });

    it('should have info section with title and version', () => {
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe('WXYC Backend API');
      expect(spec.info.version).toBeDefined();
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

    it('should define Genre enum', () => {
      const genre = spec.components.schemas.Genre as { enum?: string[] };
      expect(genre).toBeDefined();
      expect(genre.enum).toContain('Rock');
      expect(genre.enum).toContain('Jazz');
      expect(genre.enum).toContain('Electronic');
    });

    it('should define Format enum', () => {
      const format = spec.components.schemas.Format as { enum?: string[] };
      expect(format).toBeDefined();
      expect(format.enum).toContain('Vinyl');
      expect(format.enum).toContain('CD');
    });

    it('should define RotationBin enum', () => {
      const rotationBin = spec.components.schemas.RotationBin as { enum?: string[] };
      expect(rotationBin).toBeDefined();
      expect(rotationBin.enum).toEqual(['H', 'M', 'L', 'S']);
    });

    it('should define DayOfWeek enum', () => {
      const dayOfWeek = spec.components.schemas.DayOfWeek as { enum?: string[] };
      expect(dayOfWeek).toBeDefined();
      expect(dayOfWeek.enum).toContain('Monday');
      expect(dayOfWeek.enum).toContain('Sunday');
    });
  });

  describe('Flowsheet Schemas', () => {
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

    describe('track_position field (catalog-track-search Track 3 / E6)', () => {
      function getProperty(schemaName: string, prop: string): Record<string, unknown> | undefined {
        const schema = spec.components.schemas[schemaName] as
          | { properties?: Record<string, Record<string, unknown>>; allOf?: Array<{ properties?: Record<string, Record<string, unknown>> }> }
          | undefined;
        if (!schema) return undefined;
        if (schema.properties?.[prop]) return schema.properties[prop];
        for (const branch of schema.allOf ?? []) {
          if (branch.properties?.[prop]) return branch.properties[prop];
        }
        return undefined;
      }

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
      function getJoinRequestSchema(): {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      } {
        const join = spec.paths['/flowsheet/join'] as {
          post?: {
            requestBody?: {
              content?: {
                'application/json'?: {
                  schema?: {
                    properties?: Record<string, Record<string, unknown>>;
                    required?: string[];
                  };
                };
              };
            };
          };
        };
        return join?.post?.requestBody?.content?.['application/json']?.schema ?? {};
      }

      it('POST /flowsheet/join should accept optional string dj_name_override', () => {
        const schema = getJoinRequestSchema();
        const override = schema.properties?.dj_name_override;
        expect(override).toBeDefined();
        expect(override?.type).toBe('string');
      });

      it('dj_name_override should cap maxLength at 255 to match auth_user.dj_name', () => {
        const override = getJoinRequestSchema().properties?.dj_name_override;
        expect(override?.maxLength).toBe(255);
      });

      it('dj_name_override should not be in the required list', () => {
        const schema = getJoinRequestSchema();
        expect(schema.required ?? []).not.toContain('dj_name_override');
      });
    });

    describe('metadata_status field (BS#891 / Epic C)', () => {
      function getProperty(schemaName: string, prop: string): Record<string, unknown> | undefined {
        const schema = spec.components.schemas[schemaName] as
          | { properties?: Record<string, Record<string, unknown>>; allOf?: Array<{ properties?: Record<string, Record<string, unknown>> }> }
          | undefined;
        if (!schema) return undefined;
        if (schema.properties?.[prop]) return schema.properties[prop];
        for (const branch of schema.allOf ?? []) {
          if (branch.properties?.[prop]) return branch.properties[prop];
        }
        return undefined;
      }

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
        const schema = spec.components.schemas.FlowsheetEntryResponse as {
          allOf?: Array<{ required?: string[] }>;
          required?: string[];
        };
        const required = [...(schema.required ?? []), ...(schema.allOf ?? []).flatMap((b) => b.required ?? [])];
        expect(required).not.toContain('metadata_status');
      });

      it('FlowsheetV2TrackEntry should $ref MetadataStatus on metadata_status', () => {
        const ms = getProperty('FlowsheetV2TrackEntry', 'metadata_status');
        expect(ms).toBeDefined();
        expect(ms?.$ref).toBe('#/components/schemas/MetadataStatus');
      });

      it('FlowsheetV2TrackEntry should not require metadata_status', () => {
        const schema = spec.components.schemas.FlowsheetV2TrackEntry as {
          allOf?: Array<{ required?: string[] }>;
          required?: string[];
        };
        const required = [...(schema.required ?? []), ...(schema.allOf ?? []).flatMap((b) => b.required ?? [])];
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
      function getProperty(schemaName: string, prop: string): Record<string, unknown> | undefined {
        const schema = spec.components.schemas[schemaName] as
          | { properties?: Record<string, Record<string, unknown>>; allOf?: Array<{ properties?: Record<string, Record<string, unknown>> }> }
          | undefined;
        if (!schema) return undefined;
        if (schema.properties?.[prop]) return schema.properties[prop];
        for (const branch of schema.allOf ?? []) {
          if (branch.properties?.[prop]) return branch.properties[prop];
        }
        return undefined;
      }

      function requiredKeys(schemaName: string): string[] {
        const schema = spec.components.schemas[schemaName] as {
          allOf?: Array<{ required?: string[] }>;
          required?: string[];
        };
        return [...(schema.required ?? []), ...(schema.allOf ?? []).flatMap((b) => b.required ?? [])];
      }

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
    // CatalogExportRow). The SSOT leads the consumer: this list is 15 fields,
    // one ahead of that private type until Backend Track 3 (#1493) adds the
    // 15th, `popularity`.
    const EXPORT_FIELDS = [
      'id',
      'artist_name',
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

    it('defines CatalogExportRow with exactly the 15 shipped fields', () => {
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

    it('requires BearerAuth on all four catalog GET reads — no half-fixed SSOT (decision 4)', () => {
      const reads = ['/library', '/library/query', '/library/rotation', '/library/catalog'];
      for (const route of reads) {
        const path = spec.paths[route] as { get?: { security?: unknown[] } };
        expect(path?.get, route).toBeDefined();
        expect(path!.get!.security, route).toEqual([{ BearerAuth: [] }]);
      }
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
    it('should define DJ', () => {
      expect(spec.components.schemas.DJ).toBeDefined();
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
    it('should define ScheduleShift', () => {
      expect(spec.components.schemas.ScheduleShift).toBeDefined();
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

    it('should attach optional identity block to LookupResponse', () => {
      const schema = spec.components.schemas.LookupResponse as {
        properties: Record<string, { $ref?: string }>;
        required?: string[];
      };
      expect(schema.properties.identity).toBeDefined();
      expect(schema.properties.identity.$ref).toBe(
        '#/components/schemas/LookupIdentityBlock',
      );
      expect(schema.required ?? []).not.toContain('identity');
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
  });

  describe('API Endpoints', () => {
    it('should define /flowsheet endpoint', () => {
      expect(spec.paths['/flowsheet']).toBeDefined();
    });

    it('should define /library endpoint', () => {
      expect(spec.paths['/library']).toBeDefined();
    });

    it('should define /djs endpoint', () => {
      expect(spec.paths['/djs']).toBeDefined();
    });

    it('should define /schedule endpoint', () => {
      expect(spec.paths['/schedule']).toBeDefined();
    });

    it('should define /requests endpoint', () => {
      expect(spec.paths['/requests']).toBeDefined();
    });

    it('should define /metadata/album endpoint', () => {
      expect(spec.paths['/metadata/album']).toBeDefined();
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

    it('should define LiveFsEvent as a discriminated union over `type`', () => {
      const schema = spec.components.schemas.LiveFsEvent as {
        oneOf: Array<{ $ref: string }>;
        discriminator: { propertyName: string; mapping: Record<string, string> };
      };
      expect(schema).toBeDefined();
      expect(schema.oneOf).toHaveLength(2);
      expect(schema.discriminator.propertyName).toBe('type');
      expect(schema.discriminator.mapping.update).toContain('LiveFsUpdateEvent');
      expect(schema.discriminator.mapping.refetch).toContain('LiveFsRefetchEvent');
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

  describe('Security', () => {
    it('should define BearerAuth security scheme', () => {
      expect(spec.components.securitySchemes?.BearerAuth).toBeDefined();
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
    // module-internal and unexported). The contract mirrors better-auth 1.6.20 +
    // Backend-Service#1495. Error enums are the RUNTIME superset of the declared zod.
    type Schema = {
      type?: string;
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
      enum?: string[];
    };
    type Operation = {
      security?: Array<Record<string, unknown[]>>;
      parameters?: Array<{ name: string; in: string; required?: boolean }>;
      responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
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

    it('makes code/token public; approve/deny require BearerAuth; GET /device accepts an optional session', () => {
      expect((spec.paths['/auth/device/code'] as { post: Operation }).post.security).toEqual([]);
      expect((spec.paths['/auth/device/token'] as { post: Operation }).post.security).toEqual([]);
      expect((spec.paths['/auth/device/approve'] as { post: Operation }).post.security).toEqual([
        { BearerAuth: [] },
      ]);
      expect((spec.paths['/auth/device/deny'] as { post: Operation }).post.security).toEqual([{ BearerAuth: [] }]);
      // GET /device works unauthenticated (200 + status); a session only claims the code.
      expect((spec.paths['/auth/device'] as { get: Operation }).get.security).toEqual([{}, { BearerAuth: [] }]);
    });

    // ---- per-status error blocks reference the right envelope ----

    it('models /device/token errors per status (400 + 500), both DeviceAuthTokenError', () => {
      const r = (spec.paths['/auth/device/token'] as { post: Operation }).post.responses!;
      expect(Object.keys(r).sort()).toEqual(['200', '400', '500']);
      expect(r['400'].content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
      expect(r['500'].content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/DeviceAuthTokenError');
    });

    it('models approve/deny errors per status (400 + 401 + 403), all DeviceAuthActionError', () => {
      for (const route of ['/auth/device/approve', '/auth/device/deny']) {
        const r = (spec.paths[route] as { post: Operation }).post.responses!;
        expect(Object.keys(r).sort(), route).toEqual(['200', '400', '401', '403']);
        for (const code of ['400', '401', '403']) {
          expect(r[code].content?.['application/json']?.schema?.$ref, `${route} ${code}`).toBe(
            '#/components/schemas/DeviceAuthActionError'
          );
        }
      }
    });

    it('models /device/code and GET /device errors as 400-only, each its own error envelope', () => {
      const codeR = (spec.paths['/auth/device/code'] as { post: Operation }).post.responses!;
      expect(Object.keys(codeR).sort()).toEqual(['200', '400']);
      expect(codeR['400'].content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DeviceAuthCodeError'
      );
      const verifyR = (spec.paths['/auth/device'] as { get: Operation }).get.responses!;
      expect(Object.keys(verifyR).sort()).toEqual(['200', '400']);
      expect(verifyR['400'].content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/DeviceAuthVerifyError'
      );
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

    it('pins the verified better-auth version so a bump forces a conscious re-verification', () => {
      // The contract above mirrors better-auth 1.6.20 (the version Backend-Service#1495
      // runs; 1.6.20 added the /device/code `user_id` field over 1.6.18/.19). If this
      // fails after a bump, re-verify routes.mjs against the new version, update the
      // enums/fields above, then bump this string. (package.json keeps the ^1.6.18
      // caret per the issue; package-lock.json resolves it to 1.6.20.)
      const ba = JSON.parse(
        readFileSync(join(__dirname, '..', 'node_modules', 'better-auth', 'package.json'), 'utf-8')
      ) as { version: string };
      expect(ba.version).toBe('1.6.20');
    });
  });

  describe('POST /auth/wxyc/complete-onboarding (BS#1558)', () => {
    type Operation = {
      responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
      security?: unknown;
      requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
    };
    const getSchema = (name: string) => spec.components.schemas[name] as Schema;
    const props = (name: string) => Object.keys(getSchema(name).properties ?? {}).sort();

    it('declares the public complete-onboarding path', () => {
      expect((spec.paths['/auth/wxyc/complete-onboarding'] as Record<string, unknown>)?.post).toBeDefined();
    });

    it('CompleteOnboardingRequest carries invite + session fields', () => {
      expect(props('CompleteOnboardingRequest')).toEqual(['djName', 'newPassword', 'realName', 'token'].sort());
    });

    it('CompleteOnboardingResponse requires status, userId, email; username optional', () => {
      expect(props('CompleteOnboardingResponse')).toEqual(['email', 'status', 'userId', 'username'].sort());
      expect(getSchema('CompleteOnboardingResponse').required?.sort()).toEqual(['email', 'status', 'userId'].sort());
    });

    it('is public and wires request/response/error envelopes', () => {
      const op = (spec.paths['/auth/wxyc/complete-onboarding'] as { post: Operation }).post;
      expect(op.security).toEqual([]);
      expect(op.requestBody?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompleteOnboardingRequest'
      );
      expect(op.responses!['200'].content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/CompleteOnboardingResponse'
      );
      for (const code of ['400', '401', '403', '404', '503', '500']) {
        expect(op.responses![code].content?.['application/json']?.schema?.$ref).toBe(
          '#/components/schemas/CompleteOnboardingError'
        );
      }
    });
  });
});
