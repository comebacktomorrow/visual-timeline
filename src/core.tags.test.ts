import { matchesTags, parseTagFilter } from './core';

/* Panel-side tag filtering ("env=prod, room=lobby" must ALL match).
 * Pins CURRENT behaviour (safety net for #64). */

describe('parseTagFilter', () => {
  test('no filter', () => {
    expect(parseTagFilter('')).toBeNull();
    expect(parseTagFilter(undefined)).toBeNull();
    expect(parseTagFilter(null)).toBeNull();
  });

  test('comma-separated key=value pairs, trimmed and lower-cased', () => {
    expect(parseTagFilter('env=prod, room=lobby')).toEqual({ env: 'prod', room: 'lobby' });
    expect(parseTagFilter('  Env = Prod ,ROOM=Lobby  ')).toEqual({ env: 'prod', room: 'lobby' });
  });

  test('parts without a key are ignored; nothing usable means no filter', () => {
    expect(parseTagFilter('env=prod,lobby,=x')).toEqual({ env: 'prod' });
    expect(parseTagFilter('lobby,=x, ,')).toBeNull();
  });

  test('a blank key after whitespace becomes an empty-key pair that no source matches', () => {
    // NOTE: current behaviour; looks wrong because the "no key" check runs
    // before trimming: "=x" is ignored, but " =x" (as typed after ", ")
    // yields the key "", and that pair then rejects every source.
    const filter = parseTagFilter('env=prod, =x');
    expect(filter).toEqual({ env: 'prod', '': 'x' });
    expect(matchesTags({ env: 'prod' }, filter)).toBe(false);
  });

  test('the value is everything after the first "="', () => {
    expect(parseTagFilter('q=a=b')).toEqual({ q: 'a=b' });
  });

  test('an empty value is kept', () => {
    expect(parseTagFilter('env=')).toEqual({ env: '' });
  });

  test('a repeated key: the last one wins', () => {
    expect(parseTagFilter('env=prod, env=dev')).toEqual({ env: 'dev' });
  });
});

describe('matchesTags', () => {
  test('no filter matches everything, including untagged sources', () => {
    expect(matchesTags(undefined, null)).toBe(true);
    expect(matchesTags({ env: 'prod' }, null)).toBe(true);
  });

  test('every filter pair must match; extra tags are fine', () => {
    const filter = parseTagFilter('env=prod, room=lobby');
    expect(matchesTags({ env: 'prod', room: 'lobby', orient: 'portrait' }, filter)).toBe(true);
    expect(matchesTags({ env: 'prod', room: 'hall' }, filter)).toBe(false);
    expect(matchesTags({ env: 'prod' }, filter)).toBe(false);
  });

  test('tag values compare case-insensitively (the filter is already lower-cased)', () => {
    expect(matchesTags({ env: 'PROD' }, parseTagFilter('env=Prod'))).toBe(true);
  });

  test('tag KEYS are matched as given: an upper-case source key never matches', () => {
    // the filter's keys are lower-cased, the source's are not
    expect(matchesTags({ Env: 'prod' }, parseTagFilter('env=prod'))).toBe(false);
  });

  test('non-string tag values are compared as strings', () => {
    expect(matchesTags({ floor: 3 }, parseTagFilter('floor=3'))).toBe(true);
  });

  test('a filtered panel drops untagged sources', () => {
    expect(matchesTags(undefined, parseTagFilter('env=prod'))).toBe(false);
  });

  test('an empty-value filter matches a missing tag only when the source has a tags object', () => {
    // NOTE: current behaviour; looks inconsistent because "env=" matches a
    // source whose tags lack `env` ({}), but not a source with no tags at all.
    const filter = parseTagFilter('env=');
    expect(matchesTags({}, filter)).toBe(true);
    expect(matchesTags({ room: 'lobby' }, filter)).toBe(true);
    expect(matchesTags(undefined, filter)).toBe(false);
  });
});
