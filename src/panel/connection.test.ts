import { AUTH_HINT, dataSourceOptions, LEGACY_KEY_HINT, pickDataSource, resolveConnection } from './connection';

const request = jest.fn(async () => ({ status: 200, data: [] }));

describe('resolveConnection', () => {
  test('no data source, no API URL: nothing selected yet (never demo data by default)', () => {
    const c = resolveConnection({}, () => undefined, request);
    expect(c).toEqual({ state: 'none', apiUrl: '' });
  });

  test('a data source with Demo data on: demo, with nothing to fetch', () => {
    const c = resolveConnection({ datasourceUid: 'vt-demo' }, () => ({ demo: true, apiUrl: 'https://x.example' }), request);
    expect(c).toEqual({ state: 'demo', apiUrl: '' });
  });

  test('API URL option: direct mode, and a token error says how to connect one', () => {
    const c = resolveConnection({ apiUrl: ' https://frames.example.com ' }, () => undefined, request);
    expect(c).toEqual({ state: 'api', apiUrl: 'https://frames.example.com', authHint: AUTH_HINT });
  });

  test('a removed API key left in an older dashboard is never sent, only noticed', () => {
    const c = resolveConnection({ apiUrl: 'https://frames.example.com', apiKey: ' k ' }, () => undefined, request);
    expect(c).toEqual({ state: 'api', apiUrl: 'https://frames.example.com', authHint: LEGACY_KEY_HINT });
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
    expect(c.state).toBe('api');
    expect(c.apiUrl).toBe('https://private.example.com');
    expect(c).not.toHaveProperty('apiKey');
    expect(c.authHint).toBeUndefined();
    expect(c.apiFetch).toBeInstanceOf(Function);
    await c.apiFetch!('/sources');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/proxy/uid/vt-ds/api/sources' })
    );
  });

  test('a data source that no longer exists is reported as missing, not shown as demo data', () => {
    const c = resolveConnection({ datasourceUid: 'gone' }, () => undefined, request);
    expect(c).toEqual({ state: 'missing', apiUrl: '' });
  });

  test('a data source with empty settings is still an API one (its health check says what is missing)', () => {
    const c = resolveConnection({ datasourceUid: 'blank' }, () => ({}), request);
    expect(c.state).toBe('api');
    expect(c.apiFetch).toBeInstanceOf(Function);
  });
});

describe('dataSourceOptions', () => {
  test('lists data sources by name and stores the uid', () => {
    expect(dataSourceOptions([{ uid: 'vt-ds', name: 'Frames' }])).toEqual([{ label: 'Frames', value: 'vt-ds' }]);
  });
});

describe('pickDataSource', () => {
  test('the only data source is picked', () => {
    expect(pickDataSource([{ uid: 'a' }])).toBe('a');
  });
  test("among several, Grafana's default is picked", () => {
    expect(pickDataSource([{ uid: 'a' }, { uid: 'b', isDefault: true }])).toBe('b');
  });
  test('among several with no default, or none at all, the user picks', () => {
    expect(pickDataSource([{ uid: 'a' }, { uid: 'b' }])).toBeUndefined();
    expect(pickDataSource([])).toBeUndefined();
  });
});
