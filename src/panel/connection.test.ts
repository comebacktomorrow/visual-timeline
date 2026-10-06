import { AUTH_HINT, dataSourceOptions, LEGACY_KEY_HINT, resolveConnection } from './connection';

const request = jest.fn(async () => ({ status: 200, data: [] }));

describe('resolveConnection', () => {
  test('no data source, no API URL: demo data (core gets nothing to fetch)', () => {
    const c = resolveConnection({}, () => undefined, request);
    expect(c).toEqual({ apiUrl: '' });
  });

  test('API URL option: direct mode, and a token error says how to connect one', () => {
    const c = resolveConnection({ apiUrl: ' https://frames.example.com ' }, () => undefined, request);
    expect(c).toEqual({ apiUrl: 'https://frames.example.com', authHint: AUTH_HINT });
  });

  test('a removed API key left in an older dashboard is never sent, only noticed', () => {
    const c = resolveConnection({ apiUrl: 'https://frames.example.com', apiKey: ' k ' }, () => undefined, request);
    expect(c).toEqual({ apiUrl: 'https://frames.example.com', authHint: LEGACY_KEY_HINT });
    expect(JSON.stringify(c)).not.toContain('"k"');
  });

  test('a data source wins over the legacy options, and drops the panel key', async () => {
    const lookup = jest.fn(() => ({ apiUrl: 'https://private.example.com' }));
    const c = resolveConnection(
      { datasourceUid: 'vt-ds', apiUrl: 'https://public.example.com', apiKey: 'plaintext-key' },
      lookup,
      request
    );
    expect(lookup).toHaveBeenCalledWith('vt-ds');
    expect(c.apiUrl).toBe('https://private.example.com');
    expect(c).not.toHaveProperty('apiKey');
    expect(c.authHint).toBeUndefined();
    expect(c.apiFetch).toBeInstanceOf(Function);
    await c.apiFetch!('/sources');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/proxy/uid/vt-ds/api/sources' })
    );
  });

  test('an unknown data source still goes through the proxy (which reports the error)', () => {
    const c = resolveConnection({ datasourceUid: 'gone' }, () => undefined, request);
    expect(c.apiUrl).toBe('');
    expect(c.apiFetch).toBeInstanceOf(Function);
  });
});

describe('dataSourceOptions', () => {
  test('lists data sources by name and stores the uid', () => {
    expect(dataSourceOptions([{ uid: 'vt-ds', name: 'Frames' }])).toEqual([{ label: 'Frames', value: 'vt-ds' }]);
  });
});
