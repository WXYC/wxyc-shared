import { describe, it, expect } from 'vitest';
import contractJson from '../src/analytics/listener-events.json' with { type: 'json' };
import schemaJson from '../src/analytics/listener-events.schema.json' with { type: 'json' };

type ListenerEvent = {
  name: string;
  platforms: string[];
  status: string;
  properties?: Record<string, any>;
  platformProperties?: { ios?: Record<string, any>; android?: Record<string, any> };
  reconciled?: false;
  tracking?: string;
  openProperties?: boolean;
};

const contract = contractJson as {
  vocabulary: Record<string, any>;
  events: ListenerEvent[];
};
const { vocabulary, events } = contract;
const schema = schemaJson as Record<string, any>;

const RESERVED_NAMES = [
  'push_permission_prompted',
  'push_permission_result',
  'request_reply_dismissed',
  'request_reply_received',
  'request_reply_viewed',
];

function propsOf(event: ListenerEvent, platform: 'ios' | 'android'): Record<string, any> {
  if (event.platformProperties) {
    return event.platformProperties[platform] ?? {};
  }
  return event.properties ?? {};
}

/**
 * The dereference step of rule 4 in CLAUDE.md's "Analytics event contract" section: a property
 * that names a vocabulary takes that entry's type/unit/enum, with `platformEnum[platform]`
 * replacing `enum` where the vocabulary carries one for that platform.
 */
function resolveProperty(prop: Record<string, any>, platform: 'ios' | 'android'): Record<string, any> {
  const vocab = prop.vocabulary ? vocabulary[prop.vocabulary] : undefined;
  if (!vocab) return prop;
  return {
    ...prop,
    type: vocab.type,
    unit: vocab.unit ?? prop.unit,
    enum: vocab.platformEnum?.[platform] ?? vocab.enum ?? prop.enum,
  };
}

function expectKeysDeclaredIn(actual: Record<string, any>, schemaNode: Record<string, any>): void {
  const declared = Object.keys(schemaNode.properties);
  for (const key of Object.keys(actual)) {
    expect(declared).toContain(key);
  }
}

describe('listener-events contract', () => {
  it('has 44 events (8 shared + 1 android-only + 30 ios-only + 5 reserved)', () => {
    expect(events.length).toBe(44);
  });

  it('every event name is lowercase snake_case with no spaces', () => {
    for (const event of events) {
      expect(event.name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('event names are unique', () => {
    const names = events.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('events are sorted by name ascending', () => {
    const names = events.map(e => e.name);
    expect(names).toEqual([...names].sort());
  });

  it('every entry has exactly one of properties / platformProperties', () => {
    for (const event of events) {
      const hasProperties = event.properties !== undefined;
      const hasPlatformProperties = event.platformProperties !== undefined;
      expect(hasProperties !== hasPlatformProperties).toBe(true);
    }
  });

  it('every entry has a non-empty platforms subset of [ios, android]', () => {
    for (const event of events) {
      expect(event.platforms.length).toBeGreaterThan(0);
      for (const platform of event.platforms) {
        expect(['ios', 'android']).toContain(platform);
      }
    }
  });

  it('every entry has a status of shipped or reserved', () => {
    for (const event of events) {
      expect(['shipped', 'reserved']).toContain(event.status);
    }
  });

  it('reconciled appears only as false, only with platformProperties, and only alongside a tracking string', () => {
    for (const event of events) {
      if (event.reconciled === undefined) continue;
      expect(event.reconciled).toBe(false);
      expect(event.platformProperties).toBeDefined();
      expect(typeof event.tracking).toBe('string');
    }
  });

  it('every property object has a valid type and unit', () => {
    const validTypes = ['string', 'number', 'integer', 'boolean'];
    const validUnits = ['seconds', 'milliseconds', 'bytes'];
    for (const event of events) {
      const propertySets = event.platformProperties
        ? Object.values(event.platformProperties)
        : [event.properties ?? {}];
      for (const props of propertySets) {
        for (const prop of Object.values(props)) {
          expect(validTypes).toContain(prop.type);
          if ('unit' in prop) {
            expect(validUnits).toContain(prop.unit);
          }
        }
      }
    }
  });

  it('every property naming a vocabulary conforms to that vocabulary entry', () => {
    for (const event of events) {
      for (const platform of event.platforms as Array<'ios' | 'android'>) {
        for (const prop of Object.values(propsOf(event, platform))) {
          if (!prop.vocabulary) continue;
          const vocab = vocabulary[prop.vocabulary];
          expect(vocab).toBeDefined();
          expect(prop.type).toBe(vocab.type);
          if (vocab.unit) expect(prop.unit).toBe(vocab.unit);
          if (prop.enum) expect(prop.enum).toEqual(resolveProperty(prop, platform).enum);
        }
      }
    }
  });

  it('play.source and pause.source resolve to the shared source enum, per platform', () => {
    for (const name of ['play', 'pause']) {
      const event = events.find(e => e.name === name)!;
      expect(resolveProperty(propsOf(event, 'ios').source, 'ios').enum).toEqual(vocabulary.source.enum);
      expect(resolveProperty(propsOf(event, 'android').source, 'android').enum).toEqual(
        vocabulary.source.platformEnum.android
      );
    }
  });

  it('vocabulary.source.platformEnum.android is a subset of vocabulary.source.enum', () => {
    const source = vocabulary.source;
    for (const value of source.platformEnum.android) {
      expect(source.enum).toContain(value);
    }
  });

  it('duration appears only on pause, with unit seconds, and never on play', () => {
    for (const event of events) {
      const propertySets = event.platformProperties
        ? Object.values(event.platformProperties)
        : [event.properties ?? {}];
      for (const props of propertySets) {
        if (!('duration' in props)) continue;
        expect(event.name).toBe('pause');
        expect(props.duration.unit).toBe('seconds');
      }
    }
    const play = events.find(e => e.name === 'play')!;
    expect(propsOf(play, 'ios')).not.toHaveProperty('duration');
  });

  it('reserves the five DJ-replies events as status reserved on both platforms', () => {
    for (const name of RESERVED_NAMES) {
      const event = events.find(e => e.name === name);
      expect(event).toBeDefined();
      expect(event!.status).toBe('reserved');
      expect(event!.platforms).toEqual(['ios', 'android']);
    }
  });

  it('stream_error and error are both unreconciled with disjoint-or-differing platform property key sets', () => {
    for (const name of ['stream_error', 'error']) {
      const event = events.find(e => e.name === name)!;
      expect(event.reconciled).toBe(false);
      expect(event.platformProperties).toBeDefined();
    }
    const streamError = events.find(e => e.name === 'stream_error')!;
    const iosKeys = Object.keys(streamError.platformProperties?.ios ?? {});
    const androidKeys = Object.keys(streamError.platformProperties?.android ?? {});
    const intersection = iosKeys.filter(k => androidKeys.includes(k));
    expect(intersection.length).toBe(0);
  });

  it('stream_reconnected is android-only', () => {
    const event = events.find(e => e.name === 'stream_reconnected')!;
    expect(event.platforms).toEqual(['android']);
  });
});

describe('listener-events schema', () => {
  it('closes every object it defines against unknown keys', () => {
    const open: string[] = [];
    const walk = (node: any, path: string): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object' && node.properties && node.additionalProperties !== false) open.push(path);
      for (const [key, child] of Object.entries(node)) walk(child, `${path}/${key}`);
    };
    walk(schema, '#');
    expect(open).toEqual([]);
  });

  it('declares every key and every enum value the data file uses', () => {
    const eventDef = schema.$defs.event;
    expectKeysDeclaredIn(contractJson, schema);
    expectKeysDeclaredIn(contractJson.meta, schema.properties.meta);
    for (const entry of Object.values(vocabulary)) {
      expectKeysDeclaredIn(entry, schema.$defs.vocabularyEntry);
    }
    for (const event of events) {
      expectKeysDeclaredIn(event, eventDef);
      expect(eventDef.properties.status.enum).toContain(event.status);
      if (event.platformProperties) {
        expectKeysDeclaredIn(event.platformProperties, eventDef.properties.platformProperties);
      }
      for (const platform of event.platforms as Array<'ios' | 'android'>) {
        expect(eventDef.properties.platforms.items.enum).toContain(platform);
        for (const prop of Object.values(propsOf(event, platform))) {
          expectKeysDeclaredIn(prop, schema.$defs.property);
          expect(schema.$defs.propertyType.enum).toContain(prop.type);
          if ('unit' in prop) expect(schema.$defs.propertyUnit.enum).toContain(prop.unit);
        }
      }
    }
  });
});
