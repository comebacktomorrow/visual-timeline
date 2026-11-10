import { chipLinkUrl, parseChips } from './chips';

test('the chip list option: names in order, empty for the default chips', () => {
  expect(parseChips(' site, env ,room ')).toEqual(['site', 'env', 'room']);
  expect(parseChips('')).toBeUndefined();
  expect(parseChips(undefined)).toBeUndefined();
  expect(parseChips(' , ')).toBeUndefined();
});

test('a chip link gets the chip\'s key, value and host, URL-encoded', () => {
  expect(chipLinkUrl('/d/abc?var-${__chip.key}=${__chip.value}&var-host=${__host}', 'env', 'prod & test', 'cam 1'))
    .toBe('/d/abc?var-env=prod%20%26%20test&var-host=cam%201');
  expect(chipLinkUrl('https://wiki/${__host}', 'host', 'x', undefined)).toBe('https://wiki/');
});
