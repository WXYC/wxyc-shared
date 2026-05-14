import { describe, it, expect } from 'vitest';
import {
  wxycExampleArtists,
  wxycExampleAlbums,
  wxycExampleFlowsheetEntries,
  wxycExampleSearchResults,
  wxycExampleArtistList,
  wxycExampleAlbumList,
  wxycExampleFlowsheetList,
  wxycCanonicalArtistNames,
} from '../src/test-utils/wxyc-example-data.js';

describe('WXYC Example Data', () => {
  it('provides exactly 9 example artists', () => {
    expect(wxycExampleArtistList).toHaveLength(9);
  });

  it('provides exactly 8 example albums', () => {
    expect(wxycExampleAlbumList).toHaveLength(8);
  });

  it('provides exactly 8 example flowsheet entries', () => {
    expect(wxycExampleFlowsheetList).toHaveLength(8);
  });

  it('includes diacritic-bearing structured fixtures (ü, ñ, multi-diacritic Turkish ş+ı)', () => {
    const names = new Set(wxycExampleArtistList.map(a => a.artist_name));
    expect(names.has('Nilüfer Yanya')).toBe(true);
    expect(names.has('Sonido Dueñez')).toBe(true);
    expect(names.has('Aşıq Altay')).toBe(true);
  });

  it('artist IDs are in the 8000 range', () => {
    for (const artist of wxycExampleArtistList) {
      expect(artist.id).toBeGreaterThanOrEqual(8000);
      expect(artist.id).toBeLessThan(9000);
    }
  });

  it('album IDs are in the 9000 range', () => {
    for (const album of wxycExampleAlbumList) {
      expect(album.id).toBeGreaterThanOrEqual(9000);
      expect(album.id).toBeLessThan(10000);
    }
  });

  it('flowsheet entry IDs are in the 10000 range', () => {
    for (const entry of wxycExampleFlowsheetList) {
      expect(entry.id).toBeGreaterThanOrEqual(10000);
      expect(entry.id).toBeLessThan(11000);
    }
  });

  it('album artist_ids reference valid example artists', () => {
    const artistIds = new Set(wxycExampleArtistList.map(a => a.id));
    for (const album of wxycExampleAlbumList) {
      expect(artistIds.has(album.artist_id)).toBe(true);
    }
  });

  it('does not include mainstream artists', () => {
    const mainstream = ['Queen', 'Radiohead', 'Beatles', 'Led Zeppelin', 'Nirvana'];
    for (const artist of wxycExampleArtistList) {
      for (const name of mainstream) {
        expect(artist.artist_name).not.toContain(name);
      }
    }
  });

  it('named objects match convenience arrays', () => {
    expect(Object.values(wxycExampleArtists)).toEqual(wxycExampleArtistList);
    expect(Object.values(wxycExampleAlbums)).toEqual(wxycExampleAlbumList);
    expect(Object.values(wxycExampleFlowsheetEntries)).toEqual(wxycExampleFlowsheetList);
  });

  it('search results reference valid artist names (or the V/A sentinel)', () => {
    const artistNames = new Set(wxycExampleArtistList.map(a => a.artist_name));
    for (const result of Object.values(wxycExampleSearchResults)) {
      const isVariousArtists = result.artist_name === 'Various Artists';
      expect(isVariousArtists || artistNames.has(result.artist_name)).toBe(true);
    }
  });

  // Variant coverage for Classic-mode capsule and segue rendering.
  // Consumers (dj-site, tubafrenzy parity tests, BS API tests) need at least
  // one fixture row per visible variant so they can exercise the rendering
  // paths without inventing ad-hoc data.

  it('covers each rotation_bin value (H/M/L/S) in at least one flowsheet entry', () => {
    const bins = new Set(wxycExampleFlowsheetList.map(e => e.rotation_bin));
    expect(bins.has('H')).toBe(true);
    expect(bins.has('M')).toBe(true);
    expect(bins.has('L')).toBe(true);
    expect(bins.has('S')).toBe(true);
  });

  it('covers segue=true and request_flag=true in flowsheet entries', () => {
    expect(wxycExampleFlowsheetList.some(e => e.segue === true)).toBe(true);
    expect(wxycExampleFlowsheetList.some(e => e.request_flag === true)).toBe(true);
  });

  it('segue rows reference the same album as the preceding entry', () => {
    for (let i = 0; i < wxycExampleFlowsheetList.length; i++) {
      const entry = wxycExampleFlowsheetList[i]!;
      if (entry.segue !== true) continue;
      expect(i).toBeGreaterThan(0); // segue can't be on the first row
      const prev = wxycExampleFlowsheetList[i - 1]!;
      expect(entry.album_id).toBeDefined();
      expect(entry.album_id).toBe(prev.album_id);
    }
  });

  it('covers on_streaming=false in at least one search result (EXCLUSIVE capsule fixture)', () => {
    const exclusives = Object.values(wxycExampleSearchResults).filter(
      r => r.on_streaming === false
    );
    expect(exclusives.length).toBeGreaterThanOrEqual(1);
  });

  it('covers rotation_bin in at least one search result (ROTATION capsule fixture)', () => {
    const rotated = Object.values(wxycExampleSearchResults).filter(
      r => r.rotation_bin !== undefined
    );
    expect(rotated.length).toBeGreaterThanOrEqual(1);
  });

  it('covers album_artist (Various Artists credit) in at least one search result', () => {
    const compilations = Object.values(wxycExampleSearchResults).filter(
      r => r.album_artist !== undefined
    );
    expect(compilations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('wxycCanonicalArtistNames', () => {
  it('provides 100+ representative WXYC artist names', () => {
    expect(wxycCanonicalArtistNames.length).toBeGreaterThanOrEqual(100);
  });

  it('includes a known sample of WXYC-representative artists', () => {
    const expected = [
      'Autechre',
      'Stereolab',
      'Yo La Tengo',
      'Father John Misty',
      'Large Professor',
      'Sun Ra',
      'Ali Farka Toure',
      'Juana Molina',
    ];
    for (const name of expected) {
      expect(wxycCanonicalArtistNames).toContain(name);
    }
  });

  it('does not include mainstream artists', () => {
    const mainstream = ['Queen', 'Radiohead', 'The Beatles', 'Led Zeppelin', 'Nirvana'];
    for (const name of mainstream) {
      expect(wxycCanonicalArtistNames).not.toContain(name);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(wxycCanonicalArtistNames).size).toBe(wxycCanonicalArtistNames.length);
  });

  it('contains no empty or whitespace-only entries', () => {
    for (const name of wxycCanonicalArtistNames) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('includes diacritic-bearing names so consumers can exercise Unicode normalization', () => {
    const diacriticNames = wxycCanonicalArtistNames.filter(name =>
      [...name].some(c => c.charCodeAt(0) > 127)
    );
    expect(diacriticNames.length).toBeGreaterThanOrEqual(6);
    expect(diacriticNames).toContain('Nilüfer Yanya');
    expect(diacriticNames).toContain('Csillagrablók');
    expect(diacriticNames).toContain('Hermanos Gutiérrez');
    expect(diacriticNames).toContain('Sonido Dueñez'); // ñ (combining tilde)
    expect(diacriticNames).toContain('Aşıq Altay'); // multi-diacritic (Turkish ş + ı)
    expect(diacriticNames).toContain('GIDEÖN'); // capital diacritic mid-word (Ö)
  });
});
