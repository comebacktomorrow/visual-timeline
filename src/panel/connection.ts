import { ApiFetch, makeProxyFetch, ProxyRequest } from '../shared/proxy';

/** How the core reaches the frames API (see makeApiBackend in core.ts). */
export interface ApiConnection {
  /** The API's public base URL. Fetched directly only when apiFetch is unset. */
  apiUrl: string;
  /** Viewer key for direct mode. Always empty in data source mode. */
  apiKey: string;
  /** Data source mode: requests go through the data source's proxy route. */
  apiFetch?: ApiFetch;
}

export interface ConnectionOptions {
  datasourceUid?: string;
  apiUrl?: string;
  apiKey?: string;
}

/** Looks up a data source's non-secret jsonData by uid. */
export type JsonDataLookup = (uid: string) => object | undefined;

/* A selected data source wins: the API URL comes from its (non-secret)
 * settings, only to resolve image URLs, and every API call goes through
 * Grafana's proxy, which adds the viewer token server-side. Without one,
 * the legacy API URL / API key options apply; with neither, the core falls
 * back to its built-in demo data. */
export function resolveConnection(options: ConnectionOptions, lookup: JsonDataLookup, request: ProxyRequest): ApiConnection {
  const uid = (options.datasourceUid || '').trim();
  if (uid) {
    const apiUrl = (lookup(uid) as { apiUrl?: unknown } | undefined)?.apiUrl;
    return {
      apiUrl: typeof apiUrl === 'string' ? apiUrl.trim() : '',
      apiKey: '',
      apiFetch: makeProxyFetch(uid, request),
    };
  }
  return { apiUrl: (options.apiUrl || '').trim(), apiKey: (options.apiKey || '').trim() };
}
