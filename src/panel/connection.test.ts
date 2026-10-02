import { resolveConnection } from './connection';

const request = jest.fn(async () => ({ status: 200, data: [] }));

describe('resolveConnection', () => {
  test('no data source, no API URL: demo data (core gets nothing to fetch)', () => {
    const c = resolveConnection({}, () => undefined, request);
    expect(c).toEqual({ apiUrl: '', apiKey: '' });
  });

  test("legacy options: direct mode with the panel's URL and key", () => {
    const c = resolveConnection({ apiUrl: ' https://frames.example.com ', apiKey: ' k ' }, () => undefined, request);
    expect(c).toEqual({ apiUrl: 'https://frames.example.com', apiKey: 'k' });
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
    expect(c.apiKey).toBe('');
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
