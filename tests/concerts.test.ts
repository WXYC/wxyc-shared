/**
 * Tests for Concerts / On Tour Types (Backend-Service#1603)
 *
 * Validates:
 * - api.yaml defines the Venue / Concert / ConcertStatus / ConcertsResponse
 *   schemas and the GET /concerts operation with its query params
 * - Generated types accept valid object literals, including the date-only
 *   case (`starts_at: null` with `starts_on` present) that the endpoint's
 *   windowing contract is built around
 * - Internal ingestion columns are not part of the Concert schema
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import {
  ConcertStatus,
  type Concert,
  type ConcertsResponse,
  type Venue,
} from '../src/generated/models/index.js';

interface OpenAPISpec {
  components: { schemas: Record<string, any> };
  paths: Record<string, any>;
}

// =============================================================================
// Test Data
// =============================================================================

const sampleVenue: Venue = {
  id: 3,
  slug: 'cats-cradle',
  name: "Cat's Cradle",
  city: 'Carrboro',
  state: 'NC',
  address: '300 E Main St, Carrboro, NC 27510',
};

// Timed event: starts_at present, starts_on derived from it by the DB trigger.
const sampleTimedConcert: Concert = {
  id: 101,
  venue: sampleVenue,
  starts_on: '2026-08-14',
  starts_at: '2026-08-15T00:00:00.000Z',
  doors_at: '2026-08-14T23:00:00.000Z',
  headlining_artist_raw: 'Nilüfer Yanya',
  headlining_artist_id: 4211,
  title: null,
  supporting_artists_raw: ['Hermanos Gutiérrez'],
  ticket_url: 'https://catscradle.com/event/nilufer-yanya/',
  image_url: 'https://catscradle.com/img/nilufer-yanya.jpg',
  price_min: 25,
  price_max: 28,
  age_restriction: 'All Ages',
  status: 'on_sale',
};

// Date-only event: starts_at is null; only the calendar date is known.
// This is the shape range predicates on starts_at would silently drop.
const sampleDateOnlyConcert: Concert = {
  id: 102,
  venue: { ...sampleVenue, id: 7, slug: 'local-506', name: 'Local 506', address: null },
  starts_on: '2026-09-01',
  starts_at: null,
  doors_at: null,
  headlining_artist_raw: 'Csillagrablók',
  headlining_artist_id: null,
  title: 'Csillagrablók with special guests',
  supporting_artists_raw: [],
  ticket_url: null,
  image_url: null,
  price_min: null,
  price_max: null,
  age_restriction: null,
  status: 'on_sale',
};

// =============================================================================
// Generated types
// =============================================================================

describe('Concert generated types', () => {
  it('accepts a fully-populated timed concert', () => {
    expect(sampleTimedConcert.starts_at).not.toBeNull();
    expect(sampleTimedConcert.venue.slug).toBe('cats-cradle');
  });

  it('accepts a date-only concert (null starts_at, starts_on present)', () => {
    expect(sampleDateOnlyConcert.starts_at).toBeNull();
    expect(sampleDateOnlyConcert.starts_on).toBe('2026-09-01');
  });

  it('exposes ConcertStatus as a const object with the four lifecycle states', () => {
    expect(Object.values(ConcertStatus).sort()).toEqual(
      ['cancelled', 'on_sale', 'rescheduled', 'sold_out'].sort()
    );
  });

  it('composes ConcertsResponse from concerts + PaginationInfo', () => {
    const response: ConcertsResponse = {
      concerts: [sampleTimedConcert, sampleDateOnlyConcert],
      pagination: { page: 1, limit: 50, total: 2, hasMore: false },
    };
    expect(response.concerts).toHaveLength(2);
    expect(response.pagination.page).toBe(1);
  });
});

// =============================================================================
// api.yaml spec shape
// =============================================================================

describe('Concerts in api.yaml', () => {
  let spec: OpenAPISpec;

  beforeAll(() => {
    const specPath = join(__dirname, '..', 'api.yaml');
    spec = parse(readFileSync(specPath, 'utf-8')) as OpenAPISpec;
  });

  it('defines Venue, Concert, ConcertStatus, and ConcertsResponse schemas', () => {
    for (const name of ['Venue', 'Concert', 'ConcertStatus', 'ConcertsResponse']) {
      expect(spec.components.schemas[name], `schema ${name}`).toBeDefined();
    }
  });

  it('requires starts_on but marks starts_at nullable on Concert', () => {
    const concert = spec.components.schemas.Concert;
    expect(concert.required).toContain('starts_on');
    expect(concert.properties.starts_on.format).toBe('date');
    expect(concert.properties.starts_at.nullable).toBe(true);
    expect(concert.properties.starts_at.format).toBe('date-time');
  });

  it('embeds the full Venue object in Concert (not a venue_id)', () => {
    const concert = spec.components.schemas.Concert;
    expect(concert.properties.venue.$ref).toBe('#/components/schemas/Venue');
    expect(concert.properties.venue_id).toBeUndefined();
  });

  it('does not expose internal ingestion columns', () => {
    const concert = spec.components.schemas.Concert;
    for (const internal of ['raw_data', 'source', 'source_id', 'scraped_at', 'first_scraped_at']) {
      expect(concert.properties[internal], `internal column ${internal}`).toBeUndefined();
    }
  });

  it('defines GET /concerts with curated, from/to window, and page/limit params', () => {
    const operation = spec.paths['/concerts']?.get;
    expect(operation).toBeDefined();
    const params = new Map(
      (operation.parameters as Array<{ name: string; in: string; schema: any }>).map((p) => [
        p.name,
        p,
      ])
    );
    expect(params.get('curated')?.schema.type).toBe('boolean');
    expect(params.get('from')?.schema.format).toBe('date');
    expect(params.get('to')?.schema.format).toBe('date');
    expect(params.get('page')?.schema.minimum).toBe(1);
    expect(params.get('limit')?.schema.maximum).toBe(100);
    for (const p of params.values()) {
      expect(p.in).toBe('query');
    }
  });

  it('responds with ConcertsResponse and keeps the global BearerAuth security', () => {
    const operation = spec.paths['/concerts']?.get;
    expect(operation.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ConcertsResponse'
    );
    // No `security: []` opt-out — anonymous-session bearer auth, like /proxy.
    expect(operation.security).toBeUndefined();
  });
});
