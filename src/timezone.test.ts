import { setTimeZoneResolver } from '@grafana/data';
import { coreTimeZone } from './timezone';

describe('coreTimeZone (the dashboard time zone, for the core)', () => {
  afterEach(() => setTimeZoneResolver(() => 'browser'));

  test('browser time is undefined: the core then uses the browser’s zone', () => {
    expect(coreTimeZone('browser')).toBeUndefined();
  });

  test('utc and IANA names pass through', () => {
    expect(coreTimeZone('utc')).toBe('utc');
    expect(coreTimeZone('America/New_York')).toBe('America/New_York');
  });

  test('the default ("" or "default") resolves to the user’s or org’s preference', () => {
    setTimeZoneResolver(() => 'Asia/Kolkata');
    expect(coreTimeZone('')).toBe('Asia/Kolkata');
    expect(coreTimeZone(undefined)).toBe('Asia/Kolkata');
    expect(coreTimeZone('default')).toBe('Asia/Kolkata');
    setTimeZoneResolver(() => 'utc');
    expect(coreTimeZone('')).toBe('utc');
  });

  test('a preference of browser time, or none, is the browser’s zone', () => {
    setTimeZoneResolver(() => 'browser');
    expect(coreTimeZone('')).toBeUndefined();
    setTimeZoneResolver(() => '');
    expect(coreTimeZone('')).toBeUndefined();
    setTimeZoneResolver(() => undefined);
    expect(coreTimeZone('')).toBeUndefined();
  });

  test('an explicit dashboard zone wins over the preference', () => {
    setTimeZoneResolver(() => 'Asia/Kolkata');
    expect(coreTimeZone('utc')).toBe('utc');
    expect(coreTimeZone('browser')).toBeUndefined();
  });
});
