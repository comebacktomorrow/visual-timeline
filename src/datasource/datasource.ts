import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  TestDataSourceResponse,
} from '@grafana/data';

import { backendRequest } from '../shared/backendRequest';
import { ApiFetch, makeProxyFetch, ProxyRequest } from '../shared/proxy';
import type { VisualTimelineOptions, VisualTimelineQuery } from './types';

// What Grafana's data source proxy answers instead of the API's own 401:
// it turns 401 into 400, so the browser session isn't taken for expired
const PROXY_AUTH_FAILED = 'Authentication to data source failed';

/** Health-check wording for a failed GET /sources through the proxy. */
export function describeFailure(status: number, apiUrl: string, body?: unknown): string {
  switch (status) {
    case 400: {
      const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
      return text.includes(PROXY_AUTH_FAILED)
        ? `The API at ${apiUrl} rejected the viewer token (Grafana's proxy reports the API's 401 as 400). Check the token, and that the API still accepts it.`
        : `The API at ${apiUrl} refused the request (400). Grafana's proxy also reports an API 401 as 400, so check the viewer token.`;
    }
    case 401:
      return `The API at ${apiUrl} rejected the viewer token (401). Check the token, and that the API still accepts it.`;
    case 403:
      return `The API at ${apiUrl} accepted the viewer token but refused access (403). The token may be scoped to other sites.`;
    case 404:
      return `${apiUrl}/sources was not found (404). The API URL should be the frames API's base URL, without /sources.`;
    case 502:
    case 503:
    case 504:
      return `Grafana could not reach ${apiUrl} (${status}). Check the URL, and that the Grafana server can reach it.`;
    case 0:
      return `No response from ${apiUrl} through the Grafana proxy.`;
    default:
      return `GET ${apiUrl}/sources through the Grafana proxy failed (${status}).`;
  }
}

/* Frontend-only data source. Its job is to hold the API URL (jsonData) and
 * the viewer token (secureJsonData) so the panel never has to: the panel
 * sends /sources and /frames to this data source's proxy route
 * (plugin.json), and Grafana's server adds the token on the way out. */
export class VisualTimelineDataSource extends DataSourceApi<VisualTimelineQuery, VisualTimelineOptions> {
  readonly apiUrl: string;
  private readonly api: ApiFetch;

  constructor(
    instanceSettings: DataSourceInstanceSettings<VisualTimelineOptions>,
    request: ProxyRequest = backendRequest
  ) {
    super(instanceSettings);
    this.apiUrl = (instanceSettings.jsonData?.apiUrl || '').trim().replace(/\/+$/, '');
    this.api = makeProxyFetch(instanceSettings.uid, request);
  }

  /** The panel reads the API directly through the proxy; there is nothing
   * to query. plugin.json sets metrics: false, so Grafana doesn't offer this
   * data source in query editors. */
  async query(_request: DataQueryRequest<VisualTimelineQuery>): Promise<DataQueryResponse> {
    return { data: [] };
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    if (!this.apiUrl) {
      return { status: 'error', message: 'Set the API URL: the base URL of the frames API.' };
    }
    if (!/^https?:\/\/[^/]/i.test(this.apiUrl)) {
      return { status: 'error', message: 'The API URL must start with http:// or https://.' };
    }
    const r = await this.api('/sources');
    if (!r.ok) {
      return { status: 'error', message: describeFailure(r.status, this.apiUrl, await r.json()) };
    }
    const body = await r.json();
    if (!Array.isArray(body)) {
      return {
        status: 'error',
        message: `${this.apiUrl}/sources answered, but not with a list of sources. Is this a frames API?`,
      };
    }
    const n = body.length;
    return {
      status: 'success',
      message: `Connected: the API lists ${n} source${n === 1 ? '' : 's'}.`,
    };
  }
}
