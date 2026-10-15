import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceGetTagKeysOptions,
  DataSourceGetTagValuesOptions,
  DataSourceInstanceSettings,
  MetricFindValue,
  ScopedVars,
  TestDataSourceResponse,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

import { backendRequest } from '../shared/backendRequest';
import { lastFrameIn } from '../shared/lastFrame';
import { ApiFetch, makeProxyFetch, ProxyRequest } from '../shared/proxy';
import {
  applySourceFilter,
  interpolatedList,
  sourcesToFrame,
  tagKeys,
  tagValues,
} from '../shared/sources';
// the text Grafana's proxy answers instead of the API's own 401
import { makeApiBackend, PROXY_AUTH_FAILED } from '../vt/backends/api';
import { makeBackend as makeDemoBackend } from '../vt/backends/demo';
import { limited, MODEL_CONCURRENCY } from '../vt/model/pool';
import type { Backend, Frame, SourceDecl } from '../vt/types';
import type { VisualTimelineOptions, VisualTimelineQuery, VisualTimelineVariableQuery } from './types';
import { VisualTimelineVariableSupport } from './variables';

/** How long one GET /sources answer serves every caller. A dashboard load
 * asks for the list once per panel query, per Site or Host variable and per
 * filter-bar dropdown, all within a second or two. */
export const SOURCES_TTL_MS = 5000;


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

/** Replaces dashboard variables in a query field (Grafana's template
 * service; injected so tests run without a Grafana runtime). */
export type Interpolate = (value: string, scopedVars?: ScopedVars) => string;
const grafanaInterpolate: Interpolate = (value, scopedVars) => getTemplateSrv().replace(value, scopedVars, 'csv');

/* The frontend-only data source. It holds the API URL (jsonData) and the
 * viewer token (secureJsonData), and calls the API through its proxy route
 * (plugin.json), where Grafana's server adds the token. It answers panel
 * queries with the source list (dashboard variables and ad hoc filters
 * applied), feeds the Site and Host variables and the ad hoc filter bar, and
 * fetches each source's frames when the panel asks. With Demo data on, the
 * sources are the core's built-in demo ones and no API is called. */
export class VisualTimelineDataSource extends DataSourceApi<VisualTimelineQuery, VisualTimelineOptions> {
  readonly apiUrl: string;
  readonly demo: boolean;
  private readonly api: ApiFetch;
  private readonly backend: Backend;
  private cached: { at: number; list: Promise<SourceDecl[]> } | null = null;

  constructor(
    instanceSettings: DataSourceInstanceSettings<VisualTimelineOptions>,
    request: ProxyRequest = backendRequest,
    private readonly interpolate: Interpolate = grafanaInterpolate
  ) {
    super(instanceSettings);
    this.apiUrl = (instanceSettings.jsonData?.apiUrl || '').trim().replace(/\/+$/, '');
    this.demo = instanceSettings.jsonData?.demo === true;
    this.api = makeProxyFetch(instanceSettings.uid, request);
    this.backend = makeApiBackend(this.apiUrl, undefined, this.api);
    this.variables = new VisualTimelineVariableSupport(this);
  }

  /** Every source, or only those in `sites`. Demo sources depend on the time
   * window (their outages and eras sit inside it), so the window is passed
   * when there is one; the panel draws demo frames for the same window. */
  async sources(sites?: string[] | null, window?: { from: number; to: number }): Promise<SourceDecl[]> {
    if (this.demo) {
      return this.demoBackend(window).kiosks(sites ?? null) as SourceDecl[];
    }
    const all = await this.allSources();
    return sites ? all.filter((s) => sites.includes(s.site)) : all;
  }

  /** Every source the API lists, shared by callers within SOURCES_TTL_MS
   * (including one still in flight). A failure isn't kept. */
  private allSources(): Promise<SourceDecl[]> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < SOURCES_TTL_MS) {return this.cached.list;}
    const entry = { at: now, list: Promise.resolve(this.backend.kiosks(null)) };
    this.cached = entry;
    entry.list.catch(() => {
      if (this.cached === entry) {this.cached = null;}
    });
    return entry.list;
  }

  /** The built-in demo hosts and frames for a time window (an hour to now
   * without one). */
  private demoBackend(window?: { from: number; to: number }): Backend {
    const to = window?.to ?? Date.now();
    const from = window?.from ?? to - 3600e3;
    return makeDemoBackend({ from, to }, Math.max(1, to - from), 'UTC');
  }

  /** One source's frames in a window, at most one per step. The panel calls
   * this for each source it draws. Not used with Demo data: the panel draws
   * the demo frames itself. */
  async frames(site: string, id: string, from: number, to: number, step: number): Promise<Frame[]> {
    return this.backend.frames(site, id, from, to, step);
  }

  private field(value: string | undefined, scopedVars?: ScopedVars): string {
    return value ? this.interpolate(value, scopedVars) : '';
  }

  async query(request: DataQueryRequest<VisualTimelineQuery>): Promise<DataQueryResponse> {
    const window = { from: request.range.from.valueOf(), to: request.range.to.valueOf() };
    const data = await Promise.all(
      request.targets
        .filter((t) => !t.hide)
        .map(async (t) => {
          const sites = interpolatedList(this.field(t.sites, request.scopedVars));
          const hosts = interpolatedList(this.field(t.hosts, request.scopedVars));
          const tags = this.field(t.tags, request.scopedVars);
          const sources = applySourceFilter(await this.sources(sites, window), {
            sites,
            hosts,
            tags: /\$[{a-zA-Z_]/.test(tags) ? '' : tags,
            adhoc: request.filters,
          });
          const meta = { uid: this.uid, demo: this.demo };
          if (!t.lastFrame) {return sourcesToFrame(sources, t.refId, meta);}
          // the last frame at the range's end, or now if the range runs past it
          const end = Math.min(window.to, Date.now());
          const backend = this.demo ? this.demoBackend(window) : this.backend;
          const last = await Promise.all(limited(sources, MODEL_CONCURRENCY, (s) =>
            lastFrameIn(s, window.from, end, backend).catch((e) => {
              // one host's failure leaves its cells empty, not the whole table
              console.warn('[visual-timeline] last frame failed for ' + s.id + ':', e);
              return null;
            })));
          return sourcesToFrame(sources, t.refId, meta, last);
        })
    );
    return { data };
  }

  /** Values for a Site or Host dashboard variable. A plain-text query
   * ("sites" or "hosts") works too, for dashboards written by hand. */
  async metricFindQuery(
    query: VisualTimelineVariableQuery | string,
    options?: { scopedVars?: ScopedVars }
  ): Promise<MetricFindValue[]> {
    const q: Partial<VisualTimelineVariableQuery> =
      typeof query === 'string' ? { type: query.trim().toLowerCase() === 'hosts' ? 'hosts' : 'sites' } : query;
    if (q.type === 'hosts') {
      const sites = interpolatedList(this.field(q.sites, options?.scopedVars));
      // the API filters by site too, but checking here keeps any API honest
      const sources = applySourceFilter(await this.sources(sites), { sites });
      return tagValues(sources, 'host').map((text) => ({ text, value: text }));
    }
    return tagValues(await this.sources(), 'site').map((text) => ({ text, value: text }));
  }

  /** Keys for the ad hoc filter bar: site, host and every tag key among the
   * sources the other filters leave. */
  async getTagKeys(options?: DataSourceGetTagKeysOptions<VisualTimelineQuery>): Promise<MetricFindValue[]> {
    const sources = applySourceFilter(await this.sources(), { adhoc: options?.filters });
    return tagKeys(sources).map((text) => ({ text }));
  }

  /** Values for one ad hoc key, among the sources the other filters leave. */
  async getTagValues(options: DataSourceGetTagValuesOptions<VisualTimelineQuery>): Promise<MetricFindValue[]> {
    const others = (options.filters || []).filter((f) => f.key !== options.key);
    const sources = applySourceFilter(await this.sources(), { adhoc: others });
    return tagValues(sources, options.key).map((text) => ({ text }));
  }

  /** Queries with their variables replaced, for Explore and mixed panels. */
  interpolateVariablesInQueries(queries: VisualTimelineQuery[], scopedVars: ScopedVars): VisualTimelineQuery[] {
    return queries.map((q) => ({
      ...q,
      sites: this.field(q.sites, scopedVars),
      hosts: this.field(q.hosts, scopedVars),
      tags: this.field(q.tags, scopedVars),
    }));
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    if (this.demo) {
      return {
        status: 'success',
        message: 'Demo data is on: queries return built-in demo sources. No API is called.',
      };
    }
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
