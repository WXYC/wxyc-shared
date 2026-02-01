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
