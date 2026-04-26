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
  });

  describe('Security', () => {
    it('should define BearerAuth security scheme', () => {
      expect(spec.components.securitySchemes?.BearerAuth).toBeDefined();
    });
  });
});
