import { ApiFetch, makeProxyFetch, ProxyRequest } from '../shared/proxy';

/** What the panel should show:
 * - api: frames from an API, through a data source or the API URL option;
 * - demo: the core's built-in demo data, because the selected data source
 *   has Demo data turned on;
 * - none: nothing selected yet (the panel shows how to pick or create one);
 * - missing: the selected data source no longer exists. */
export type ConnectionState = 'api' | 'demo' | 'none' | 'missing';

/** How the core reaches the frames API (see makeApiBackend in core.ts). */
export interface ApiConnection {
  state: ConnectionState;
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
 * Grafana's proxy, which adds the viewer token server-side. A data source
 * with Demo data on gives the core nothing to fetch, so it draws its
 * built-in demo. Without a data source, the API URL option applies, for an
 * API with open reads; with neither, there is nothing to show yet. Demo data
 * is never a fallback: a missing or broken data source says so. The panel
 * never sends a token of its own. */
export function resolveConnection(
  options: ConnectionOptions,
  lookup: JsonDataLookup,
  request: ProxyRequest
): ApiConnection {
  const uid = (options.datasourceUid || '').trim();
  if (uid) {
    const settings = lookup(uid) as { apiUrl?: unknown; demo?: unknown } | undefined;
    if (!settings) {return { state: 'missing', apiUrl: '' };}
    if (settings.demo === true) {return { state: 'demo', apiUrl: '' };}
    const apiUrl = settings.apiUrl;
    return {
      state: 'api',
      apiUrl: typeof apiUrl === 'string' ? apiUrl.trim() : '',
      apiFetch: makeProxyFetch(uid, request),
    };
  }
  const apiUrl = (options.apiUrl || '').trim();
  if (!apiUrl) {return { state: 'none', apiUrl };}
  return { state: 'api', apiUrl, authHint: (options.apiKey || '').trim() ? LEGACY_KEY_HINT : AUTH_HINT };
}

/** Choices for the panel's Data source option: the Visual Timeline API data
 * sources, by name, stored by uid. */
export function dataSourceOptions(list: Array<{ uid: string; name: string }>) {
  return list.map((ds) => ({ label: ds.name, value: ds.uid }));
}

/** The data source a panel with none selected should take, while it is being
 * edited: the only Visual Timeline data source, or, among several, the one
 * that is Grafana's default. Otherwise none: the user picks. */
export function pickDataSource(list: Array<{ uid: string; isDefault?: boolean }>): string | undefined {
  if (list.length === 1) {return list[0].uid;}
  const defaults = list.filter((ds) => ds.isDefault);
  return defaults.length === 1 ? defaults[0].uid : undefined;
}
