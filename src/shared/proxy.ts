/* How the panel and the data source reach the frames API through Grafana's
 * data source proxy. Pure: the Grafana request function is passed in (see
 * backendRequest.ts), so this is testable without a Grafana runtime. */

export const PANEL_ID = 'savvycocoa1919-visualtimeline-panel';
export const DATASOURCE_ID = 'savvycocoa1919-visualtimeline-datasource';

/** routes[].path in datasource/plugin.json. Grafana matches requests under
 * /api/datasources/proxy/uid/<uid>/<PROXY_ROUTE>/ to that route, swaps the
 * prefix for the configured API URL and adds the viewer token header. */
export const PROXY_ROUTE = 'api';

/** The proxy URL that stands for the API base of data source `uid`. */
export function proxyBaseUrl(uid: string): string {
  return `/api/datasources/proxy/uid/${encodeURIComponent(uid)}/${PROXY_ROUTE}`;
}

/** What core.ts's makeApiBackend expects from an injected fetch. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}
export type ApiFetch = (path: string) => Promise<ApiResponse>;

/** The slice of Grafana's BackendSrvRequest this module uses. */
export interface ProxyRequestOptions {
  url: string;
  method: 'GET';
  showErrorAlert: boolean;
  showSuccessAlert: boolean;
  abortSignal?: AbortSignal;
}
/** Resolves with the parsed body on 2xx; rejects with Grafana's FetchError
 * shape ({ status, data, ... }) otherwise. */
export type ProxyRequest = (options: ProxyRequestOptions) => Promise<{ status: number; data: unknown }>;

const REQUEST_TIMEOUT_MS = 15000;

/** An ApiFetch for core.ts that sends every request through data source
 * `uid`'s proxy route. `path` is the API path with its query string
 * (`/sources?site=a`). Failures become { ok: false, status } like a fetch
 * Response, so the core's own error handling applies unchanged. */
export function makeProxyFetch(uid: string, request: ProxyRequest): ApiFetch {
  const base = proxyBaseUrl(uid);
  return async (path: string) => {
    try {
      const r = await request({
        url: base + path,
        method: 'GET',
        // the panel and the health check report failures themselves
        showErrorAlert: false,
        showSuccessAlert: false,
        // a hung API must surface as an error, as in the core's direct mode
        abortSignal:
          typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            : undefined,
      });
      return { ok: true, status: r.status, json: async () => r.data };
    } catch (err: unknown) {
      const e = (err || {}) as { status?: unknown; data?: unknown };
      return {
        ok: false,
        status: typeof e.status === 'number' ? e.status : 0,
        json: async () => e.data,
      };
    }
  };
}
