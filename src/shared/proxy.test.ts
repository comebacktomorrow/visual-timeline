import datasourcePluginJson from '../datasource/plugin.json';
import panelPluginJson from '../panel/plugin.json';
import { DATASOURCE_ID, makeProxyFetch, PANEL_ID, PROXY_ROUTE, proxyBaseUrl, ProxyRequestOptions } from './proxy';

describe('proxyBaseUrl', () => {
  test('points at the data source proxy route', () => {
    expect(proxyBaseUrl('vt-ds')).toBe('/api/datasources/proxy/uid/vt-ds/api');
  });

  test('encodes the uid', () => {
    expect(proxyBaseUrl('a/b')).toBe('/api/datasources/proxy/uid/a%2Fb/api');
  });
});

describe('ids and route match the plugin.json files', () => {
  test('the proxy route is the one plugin.json declares, GET only, token from secureJsonData', () => {
    const route = datasourcePluginJson.routes.find((r) => r.path === PROXY_ROUTE);
    expect(route).toBeDefined();
    expect(route!.method).toBe('GET');
    expect(route!.url).toBe('{{ .JsonData.apiUrl }}');
    expect(route!.headers).toEqual([
      {
        name: 'Authorization',
        content: '{{ if .SecureJsonData.viewerToken }}Bearer {{ .SecureJsonData.viewerToken }}{{ end }}',
      },
    ]);
  });

  test('plugin ids', () => {
    expect(datasourcePluginJson.id).toBe(DATASOURCE_ID);
    // existing dashboards reference the panel by this id: it must never change
    expect(panelPluginJson.id).toBe(PANEL_ID);
    expect(PANEL_ID).toBe('savvycocoa1919-visualtimeline-panel');
  });
});

describe('makeProxyFetch', () => {
  test("sends GETs under the proxy base without Grafana's own alerts", async () => {
    const request = jest.fn(async (_o: ProxyRequestOptions) => ({ status: 200, data: [{ id: 'source-1' }] }));
    const api = makeProxyFetch('vt-ds', request);
    const r = await api('/sources?site=a');
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual([{ id: 'source-1' }]);
    const opts = request.mock.calls[0][0];
    expect(opts).toMatchObject({
      url: '/api/datasources/proxy/uid/vt-ds/api/sources?site=a',
      method: 'GET',
      showErrorAlert: false,
      showSuccessAlert: false,
    });
  });

  test('an HTTP error becomes { ok: false, status } with the error body', async () => {
    const api = makeProxyFetch('vt-ds', async () => {
      throw { status: 401, data: { message: 'unauthorized' } };
    });
    const r = await api('/sources');
    expect(r).toMatchObject({ ok: false, status: 401 });
    await expect(r.json()).resolves.toEqual({ message: 'unauthorized' });
  });

  test('a failure without a status (network, abort) is status 0', async () => {
    const api = makeProxyFetch('vt-ds', async () => {
      throw new Error('aborted');
    });
    await expect(api('/sources')).resolves.toMatchObject({ ok: false, status: 0 });
  });
});
