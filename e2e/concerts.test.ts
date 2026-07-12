/**
 * Concerts (Touring Events) E2E Tests
 *
 * The cross-repo wire-contract gate for `GET /concerts` (Backend-Service
 * #1603 / touring-events Phase 2). Where `tests/concerts.test.ts` pins the
 * `api.yaml` shape statically, this suite hits a *running* backend and
 * asserts the live payload decodes through the **generated** `Concert` /
 * `ConcertsResponse` / `Venue` / `ConcertStatus` types — the same codegen
 * SSOT the iOS, Android, dj-site, and TypeScript consumers build against.
 * If the endpoint ever drifts from the schema (a renamed field, a leaked
 * internal column, a status value outside the enum), this catches it before
 * a client does.
 *
 * `/concerts` has no create-via-API path — rows are produced by the
 * scraper/ETL jobs. So the row-dependent assertions self-seed a deterministic
 * set directly into the stack DB (prefix-keyed for a clean prefix DELETE) and
 * skip when `E2E_DB_URL` is unset. The auth gate and the envelope/shape
 * contract run regardless.
 *
 * Prerequisites:
 * - `npm run generate:typescript` has been run (generated types present)
 * - Backend running at E2E_BASE_URL (default http://localhost:8080)
 * - Auth running at E2E_AUTH_URL (default http://localhost:8081/auth)
 * - For the seeded assertions: E2E_DB_URL = a Postgres connection string for
 *   the stack DB (and E2E_SCHEMA_NAME if not the default `wxyc_schema`).
 *
 * Run with: npm run test:e2e -- e2e/concerts.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createE2EClient, getAnonymousJwt, getE2EConfig, waitForService, type E2EClient } from './setup.js';
import { ConcertStatus, type Concert, type ConcertsResponse } from '../src/generated/models/index.js';

// Namespaced so teardown is a prefix DELETE and nothing leaks across runs
// (the CI schema is shared and reused).
const SOURCE_ID_PREFIX = 'wxyc-shared-e2e:';
const VENUE_SLUG = 'wxyc-shared-e2e-room';
const ARTIST_NAME = 'WXYC Shared E2E Headliner';

const config = getE2EConfig();
const hasDb = Boolean(config.dbUrl);

/** YYYY-MM-DD for today + offsetDays in America/New_York (the endpoint's window tz). */
function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(d);
}

const PAST = isoDate(-30);
const IN_10 = isoDate(10); // timed, curated (resolved headliner)
const IN_20 = isoDate(20); // date-only (NULL starts_at) — the regression row
const IN_25 = isoDate(25); // removed (tombstoned)

const VALID_STATUSES = new Set<string>(Object.values(ConcertStatus));

// ---------------------------------------------------------------------------
// Runtime contract validators
//
// The generated TS types are erased at runtime, so these hand-check that a
// live payload conforms to the generated `Concert` / `Venue` shape field by
// field — including that every nullable key is *present* (not omitted) and
// that no internal ingestion column leaks onto the wire. This is what makes
// the suite a cross-repo contract gate rather than a smoke test.
// ---------------------------------------------------------------------------

const INTERNAL_COLUMNS = [
  'source',
  'source_id',
  'raw_data',
  'scraped_at',
  'first_scraped_at',
  'removed_at',
  'venue_id',
] as const;

function expectString(value: unknown, label: string): void {
  expect(typeof value, label).toBe('string');
}

function expectNullableString(value: unknown, label: string): void {
  expect(value === null || typeof value === 'string', `${label} (string | null)`).toBe(true);
}

function expectNullableNumber(value: unknown, label: string): void {
  expect(value === null || typeof value === 'number', `${label} (number | null)`).toBe(true);
}

function expectMatchesVenueShape(venue: Record<string, unknown>): void {
  expect(typeof venue.id, 'venue.id').toBe('number');
  expectString(venue.slug, 'venue.slug');
  expectString(venue.name, 'venue.name');
  expectString(venue.city, 'venue.city');
  expectString(venue.state, 'venue.state');
  expectNullableString(venue.address, 'venue.address');
  for (const internal of INTERNAL_COLUMNS) {
    expect(venue, `venue leaks internal column ${internal}`).not.toHaveProperty(internal);
  }
}

function expectMatchesConcertShape(concert: Record<string, unknown>): void {
  expect(typeof concert.id, 'concert.id').toBe('number');

  expect(concert.venue, 'concert.venue present').toBeTruthy();
  expectMatchesVenueShape(concert.venue as Record<string, unknown>);

  expectString(concert.starts_on, 'concert.starts_on');
  expectNullableString(concert.starts_at, 'concert.starts_at');
  expectNullableString(concert.doors_at, 'concert.doors_at');
  expectString(concert.headlining_artist_raw, 'concert.headlining_artist_raw');
  expectNullableNumber(concert.headlining_artist_id, 'concert.headlining_artist_id');
  expectNullableString(concert.title, 'concert.title');

  expect(Array.isArray(concert.supporting_artists_raw), 'concert.supporting_artists_raw is array').toBe(true);
  for (const s of concert.supporting_artists_raw as unknown[]) {
    expectString(s, 'supporting_artists_raw[]');
  }

  expectNullableString(concert.ticket_url, 'concert.ticket_url');
  expectNullableString(concert.image_url, 'concert.image_url');
  // event_url (BS#1609): the key must always be present, null when no venue
  // page is known — clients fall back to ticket_url on null, not on absence.
  expect(concert, 'concert.event_url key present').toHaveProperty('event_url');
  expectNullableString(concert.event_url, 'concert.event_url');
  expectNullableNumber(concert.price_min, 'concert.price_min');
  expectNullableNumber(concert.price_max, 'concert.price_max');
  expectNullableString(concert.age_restriction, 'concert.age_restriction');

  expect(VALID_STATUSES.has(concert.status as string), `concert.status "${concert.status}" in ConcertStatus`).toBe(
    true
  );

  for (const internal of INTERNAL_COLUMNS) {
    expect(concert, `concert leaks internal column ${internal}`).not.toHaveProperty(internal);
  }
}

function expectMatchesConcertsResponseShape(body: unknown): asserts body is ConcertsResponse {
  const response = body as Record<string, unknown>;
  expect(Array.isArray(response.concerts), 'response.concerts is array').toBe(true);
  expect(response.pagination, 'response.pagination present').toBeTruthy();
  const pagination = response.pagination as Record<string, unknown>;
  for (const key of ['page', 'limit', 'total'] as const) {
    expect(typeof pagination[key], `pagination.${key}`).toBe('number');
  }
  expect(typeof pagination.hasMore, 'pagination.hasMore').toBe('boolean');
  for (const concert of response.concerts as Record<string, unknown>[]) {
    expectMatchesConcertShape(concert);
  }
}

// ---------------------------------------------------------------------------

describe('Concerts E2E', () => {
  let client: E2EClient;
  let sql: ReturnType<typeof postgres> | undefined;
  const SCHEMA = config.schemaName;

  const seedConcert = async (overrides: Record<string, unknown>): Promise<void> => {
    const row = {
      source: 'triangle_shows',
      starts_at: null,
      doors_at: null,
      headlining_artist_id: null,
      title: null,
      supporting_artists: [] as string[],
      ticket_url: null,
      image_url: null,
      event_url: null,
      price_min: null,
      price_max: null,
      age_restriction: null,
      status: 'on_sale',
      removed_at: null,
      ...overrides,
    };
    await sql!.unsafe(
      `INSERT INTO "${SCHEMA}".concerts
         (source, source_id, venue_id, starts_on, starts_at, doors_at,
          headlining_artist_raw, headlining_artist_id, title, supporting_artists_raw,
          ticket_url, image_url, price_min, price_max, age_restriction, status,
          removed_at, event_url, raw_data, scraped_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, '{}'::jsonb, now())`,
      [
        row.source,
        SOURCE_ID_PREFIX + row.key,
        row.venue_id,
        row.starts_on,
        row.starts_at,
        row.doors_at,
        row.headlining_artist_raw,
        row.headlining_artist_id,
        row.title,
        row.supporting_artists,
        row.ticket_url,
        row.image_url,
        row.price_min,
        row.price_max,
        row.age_restriction,
        row.status,
        row.removed_at,
        row.event_url,
      ]
    );
  };

  const cleanup = async (): Promise<void> => {
    if (!sql) return;
    await sql.unsafe(`DELETE FROM "${SCHEMA}".concerts WHERE source_id LIKE $1`, [`${SOURCE_ID_PREFIX}%`]);
    await sql.unsafe(`DELETE FROM "${SCHEMA}".venues WHERE slug = $1`, [VENUE_SLUG]);
    await sql.unsafe(`DELETE FROM "${SCHEMA}".artists WHERE artist_name = $1`, [ARTIST_NAME]);
  };

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
    client.setAuthToken(await getAnonymousJwt(config.authUrl));

    if (!hasDb) return;

    sql = postgres(config.dbUrl!, { max: 1, onnotice: () => {} });
    await cleanup(); // idempotent across re-runs on the shared schema

    const [venue] = await sql.unsafe(
      `INSERT INTO "${SCHEMA}".venues (slug, name, city, state, address)
       VALUES ($1, 'WXYC Shared E2E Room', 'Carrboro', 'NC', '300 E Main St')
       RETURNING id`,
      [VENUE_SLUG]
    );
    const venueId = (venue as { id: number }).id;

    const [artist] = await sql.unsafe(
      `INSERT INTO "${SCHEMA}".artists (artist_name, alphabetical_name, code_letters)
       VALUES ($1, $1, 'ZZ') RETURNING id`,
      [ARTIST_NAME]
    );
    const artistId = (artist as { id: number }).id;

    // Past — excluded by the default "today forward" window.
    await seedConcert({
      key: 'past',
      venue_id: venueId,
      starts_on: PAST,
      headlining_artist_raw: 'Long Gone Act',
    });

    // Timed + curated: resolved headliner, fully populated optionals incl.
    // event_url distinct from ticket_url. 23:30Z keeps starts_on on IN_10 in ET.
    await seedConcert({
      key: 'timed-curated',
      venue_id: venueId,
      starts_on: IN_10,
      starts_at: `${IN_10}T23:30:00.000Z`,
      doors_at: `${IN_10}T22:30:00.000Z`,
      headlining_artist_raw: ARTIST_NAME,
      headlining_artist_id: artistId,
      supporting_artists: ['Opener A', 'Opener B'],
      ticket_url: 'https://example.com/tickets/e2e',
      image_url: 'https://example.com/img/e2e.jpg',
      event_url: 'https://example.com/venue/event/e2e',
      price_min: '30.00',
      price_max: '34.50',
      age_restriction: 'All Ages',
    });

    // Date-only (NULL starts_at) — the regression row a starts_at range
    // predicate would drop; event_url null so clients fall back to ticket_url.
    await seedConcert({
      key: 'date-only',
      venue_id: venueId,
      starts_on: IN_20,
      headlining_artist_raw: 'Date-Only Billing',
      title: 'Date-Only Billing with special guests',
    });

    // Tombstoned — must never appear.
    await seedConcert({
      key: 'removed',
      venue_id: venueId,
      starts_on: IN_25,
      headlining_artist_raw: ARTIST_NAME,
      headlining_artist_id: artistId,
      removed_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await cleanup();
    await sql?.end();
  });

  /** Concerts from a response body that belong to this suite's seed. */
  const seeded = (body: ConcertsResponse): Concert[] => body.concerts.filter((c) => c.venue.slug === VENUE_SLUG);

  describe('auth', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const unauth = createE2EClient();
      const res = await unauth.get('/concerts');
      expect(res.status).toBe(401);
    });
  });

  describe('wire contract (generated types)', () => {
    it('returns a ConcertsResponse whose every concert matches the generated Concert shape', async () => {
      const res = await client.get<ConcertsResponse>('/concerts?limit=100');
      expect(res.status).toBe(200);
      // Validates envelope + every row against the codegen SSOT, and that no
      // internal ingestion column leaks. Runs even with an empty feed.
      expectMatchesConcertsResponseShape(res.body);
    });
  });

  describe('seeded rows (requires E2E_DB_URL)', () => {
    it.skipIf(!hasDb)(
      'serves upcoming non-removed rows ordered by starts_on, including the date-only row',
      async () => {
        const res = await client.get<ConcertsResponse>('/concerts?limit=100');
        expect(res.status).toBe(200);

        const rows = seeded(res.body);
        const billings = rows.map((c) => c.headlining_artist_raw);

        // The date-only (NULL starts_at) row survives the window — regression guard.
        const dateOnly = rows.find((c) => c.headlining_artist_raw === 'Date-Only Billing');
        expect(dateOnly).toBeDefined();
        expect(dateOnly!.starts_at).toBeNull();
        expect(dateOnly!.starts_on).toBe(IN_20);
        expect(dateOnly!.event_url).toBeNull();

        // Past and removed rows are absent.
        expect(billings).not.toContain('Long Gone Act');
        expect(rows.filter((c) => c.headlining_artist_raw === ARTIST_NAME)).toHaveLength(1);

        // Ordered by starts_on ascending.
        expect(billings).toEqual([ARTIST_NAME, 'Date-Only Billing']);
      }
    );

    it.skipIf(!hasDb)('serves the fully-populated timed row with the venue embedded and event_url set', async () => {
      const res = await client.get<ConcertsResponse>('/concerts?limit=100');
      const timed = seeded(res.body).find((c) => c.headlining_artist_raw === ARTIST_NAME);
      expect(timed).toBeDefined();

      expect(timed).toMatchObject({
        starts_on: IN_10,
        supporting_artists_raw: ['Opener A', 'Opener B'],
        ticket_url: 'https://example.com/tickets/e2e',
        image_url: 'https://example.com/img/e2e.jpg',
        event_url: 'https://example.com/venue/event/e2e',
        price_min: 30,
        price_max: 34.5,
        age_restriction: 'All Ages',
        status: 'on_sale',
        venue: {
          slug: VENUE_SLUG,
          name: 'WXYC Shared E2E Room',
          city: 'Carrboro',
          state: 'NC',
        },
      });
      expect(typeof timed!.headlining_artist_id).toBe('number');
      expect(new Date(timed!.starts_at!).toISOString()).toBe(`${IN_10}T23:30:00.000Z`);
    });

    it.skipIf(!hasDb)('narrows to resolver-stamped rows with curated=true', async () => {
      const res = await client.get<ConcertsResponse>('/concerts?curated=true&limit=100');
      expect(res.status).toBe(200);
      const rows = seeded(res.body);
      expect(rows).toHaveLength(1);
      expect(rows[0].headlining_artist_raw).toBe(ARTIST_NAME);
      expect(typeof rows[0].headlining_artist_id).toBe('number');
    });
  });
});
