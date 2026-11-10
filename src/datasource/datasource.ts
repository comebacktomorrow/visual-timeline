import {
  DataFrame,
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

import { lastFrameIn } from '../shared/lastFrame';
import {
  applySourceFilter,
  interpolatedList,
  annotationsToFrame,
  pauseStatesToFrame,
  lastFramesByHost,
  recordsToFrame,
  sourcesToFrame,
  tagKeys,
  tagValues,
} from '../shared/sources';
import { DemoBackend, makeBackend as makeDemoBackend } from '../vt/backends/demo';
import { resolveTimeZone } from '../vt/time/zones';
import { coreTimeZone } from '../timezone';
import { limited, MODEL_CONCURRENCY } from '../vt/model/pool';
import type { SourceDecl } from '../vt/types';
import type { VisualTimelineOptions, VisualTimelineQuery, VisualTimelineVariableQuery } from './types';
import { VisualTimelineVariableSupport } from './variables';

/** Replaces dashboard variables in a query field (Grafana's template
 * service; injected so tests run without a Grafana runtime). */
export type Interpolate = (value: string, scopedVars?: ScopedVars) => string;
const grafanaInterpolate: Interpolate = (value, scopedVars) => getTemplateSrv().replace(value, scopedVars, 'csv');

/* The frontend-only data source. With Demo data on, it answers panel
 * queries with built-in demo hosts and their frames as rows (time, host,
 * site, image), the way any data source can (#126), feeds the Site and Host
 * variables and the ad hoc filter bar, and answers annotation queries with
 * the demo events. Without it there is nothing to read yet: the folder and
 * bucket listings (#125) come before 2.0. The frames API mode of 1.x is gone
 * (#126); its worker is read through a stock data source such as Infinity. */
export class VisualTimelineDataSource extends DataSourceApi<VisualTimelineQuery, VisualTimelineOptions> {
  readonly demo: boolean;

  constructor(
    instanceSettings: DataSourceInstanceSettings<VisualTimelineOptions>,
    private readonly interpolate: Interpolate = grafanaInterpolate
  ) {
    super(instanceSettings);
    this.demo = instanceSettings.jsonData?.demo === true;
    this.variables = new VisualTimelineVariableSupport(this);
    // annotation queries: Demo data's demo events, as dashboard annotations
    this.annotations = { getDefaultQuery: () => ({ kind: 'annotations' }) };
  }

  /** Every source, or only those in `sites`. Demo sources depend on the time
   * window (their outages and eras sit inside it), so the window is passed
   * when there is one. Without Demo data there are none yet. */
  async sources(sites?: string[] | null, window?: { from: number; to: number }): Promise<SourceDecl[]> {
    return this.demo ? (this.demoBackend(window).kiosks(sites ?? null) as SourceDecl[]) : [];
  }

  /** The built-in demo hosts and frames for a time window (an hour to now
   * without one). */
  private demoBackend(window?: { from: number; to: number }, timeZone = 'UTC'): DemoBackend {
    const to = window?.to ?? Date.now();
    const from = window?.from ?? to - 3600e3;
    return makeDemoBackend({ from, to }, Math.max(1, to - from), timeZone);
  }

  private field(value: string | undefined, scopedVars?: ScopedVars): string {
    return value ? this.interpolate(value, scopedVars) : '';
  }

  async query(request: DataQueryRequest<VisualTimelineQuery>): Promise<DataQueryResponse> {
    const window = { from: request.range.from.valueOf(), to: request.range.to.valueOf() };
    const data = await Promise.all(
      request.targets
        .filter((t) => !t.hide)
        .map(async (t): Promise<DataFrame | DataFrame[]> => {
          if (t.kind === 'annotations') {
            return annotationsToFrame(this.demo ? this.demoBackend(window).annotations() : [], t.refId);
          }
          const sites = interpolatedList(this.field(t.sites, request.scopedVars));
          const hosts = interpolatedList(this.field(t.hosts, request.scopedVars));
          const tags = this.field(t.tags, request.scopedVars);
          const sources = applySourceFilter(await this.sources(sites, window), {
            sites,
            hosts,
            tags: /\$[{a-zA-Z_]/.test(tags) ? '' : tags,
            adhoc: request.filters,
          });
          if (!t.lastFrame) {
            const list = sourcesToFrame(sources, t.refId);
            // Demo data answers with its frames as rows, as any source would (#126)
            // the demo frames draw a clock: in the dashboard's time zone, so they agree with the captions
            const tz = resolveTimeZone(coreTimeZone(request.timezone));
            // and its pauses as state rows, so the panel reads them as it would anyone's (#126, M4)
            return this.demo
              ? [list, await this.demoRecords(sources, window, request.maxDataPoints, t.refId, tz), pauseStatesToFrame(sources, t.refId)]
              : list;
          }
          // the last frame at the range's end, or now if the range runs past it
          const end = Math.min(window.to, Date.now());
          const backend = this.demoBackend(window);
          const last = await Promise.all(limited(sources, MODEL_CONCURRENCY, (s) =>
            lastFrameIn(s, window.from, end, backend).catch((e) => {
              // one host's failure leaves its cells empty, not the whole table
              console.warn('[visual-timeline] last frame failed for ' + s.id + ':', e);
              return null;
            })));
          return t.lastFrameFormat === 'host'
            ? lastFramesByHost(sources, last, t.refId)
            : sourcesToFrame(sources, t.refId, last);
        })
    );
    return { data: data.flat() };
  }

  /* Demo frames for these sources as rows. Each source's rows come at the
   * finest cadence it has in the window (source-3 changes pace mid-window),
   * or coarser for a long window, so there are never more rows per source
   * than the panel has pixels. */
  private async demoRecords(
    sources: SourceDecl[], window: { from: number; to: number }, maxDataPoints: number | undefined, refId: string, timeZone: string
  ) {
    const demo = this.demoBackend(window, timeZone);
    const span = Math.max(1, window.to - window.from);
    const rows: Array<{ ts: number; host: string; site: string; url: string; cadence: number }> = [];
    for (const s of sources) {
      const cadences = [s.cadence, ...(s.history || []).map((h) => h.cadence)].filter((c): c is number => !!c && c > 0);
      const finest = Math.min(...cadences);
      const step = finest * Math.max(1, Math.ceil(span / (maxDataPoints || 1000) / finest));
      // each row carries the pace in force at its time, so a change of pace
      // reaches the panel as any query's would: as a cadence field that changes
      const paces = (s.history || []).filter((h) => h.cadence && (h.variant || 'lo') === 'lo').sort((a, b) => a.since - b.since);
      const paceAt = (ts: number) => paces.filter((h) => h.since <= ts).pop()?.cadence ?? s.cadence;
      for (const f of await demo.frames(s.site, s.id, window.from, window.to, step)) {
        rows.push({ ts: f.ts, host: s.id, site: s.site, url: f.url, cadence: paceAt(f.ts) });
      }
    }
    return recordsToFrame(rows, refId);
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
      return { status: 'success', message: 'Demo data is on: queries return built-in demo hosts and frames.' };
    }
    return {
      status: 'error',
      message:
        'Nothing to read yet: turn on Demo data. Panels read your own frames from any data source that returns rows of time, image and host.',
    };
  }
}
