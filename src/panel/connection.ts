import { ApiFetch, makeProxyFetch, ProxyRequest } from '../shared/proxy';

/** How the core reaches the frames API (see makeApiBackend in core.ts). */
export interface ApiConnection {
  /** The API's public base URL. Fetched directly only when apiFetch is unset. */
  apiUrl: string;
  /** Data source mode: requests go through the data source's proxy route. */
  apiFetch?: ApiFetch;
  /** Direct mode: added to a token error, since the panel itself can't send one. */
  authHint?: string;
}

export interface ConnectionOptions {
  datasourceUid?: string;
  apiUrl?: string;
  /** The removed API key option. Older dashboards may still carry it; it is
   * never sent, only noticed, so the error can say what changed. */
  apiKey?: string;
}

export const AUTH_HINT =
  'An API that needs a viewer token connects through a Visual Timeline API data source (the Data source option).';
export const LEGACY_KEY_HINT =
  "This panel's API key option has been removed: connect it through a Visual Timeline API data source (the Data source option) instead.";

/** Looks up a data source's non-secret jsonData by uid. */
export type JsonDataLookup = (uid: string) => object | undefined;

/* A selected data source wins: the API URL comes from its (non-secret)
 * settings, only to resolve image URLs, and every API call goes through
 * Grafana's proxy, which adds the viewer token server-side. Without one,
 * the API URL option applies, for an API with open reads; with neither, the
 * core falls back to its built-in demo data. The panel never sends a token
 * of its own. */
export function resolveConnection(
  options: ConnectionOptions,
  lookup: JsonDataLookup,
  request: ProxyRequest
): ApiConnection {
  const uid = (options.datasourceUid || '').trim();
  if (uid) {
    const apiUrl = (lookup(uid) as { apiUrl?: unknown } | undefined)?.apiUrl;
    return {
      apiUrl: typeof apiUrl === 'string' ? apiUrl.trim() : '',
      apiFetch: makeProxyFetch(uid, request),
    };
  }
  const apiUrl = (options.apiUrl || '').trim();
  if (!apiUrl) {return { apiUrl };}
  return { apiUrl, authHint: (options.apiKey || '').trim() ? LEGACY_KEY_HINT : AUTH_HINT };
}

/** Choices for the panel's Data source option: the Visual Timeline API data
 * sources, by name, stored by uid. */
export function dataSourceOptions(list: Array<{ uid: string; name: string }>) {
  return list.map((ds) => ({ label: ds.name, value: ds.uid }));
}
