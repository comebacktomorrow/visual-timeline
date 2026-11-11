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
  TimeRange,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

import { HostRecords, recordsBackend, thinWithCounts } from '../shared/frameRecords';
import { lastFrameIn } from '../shared/lastFrame';
import { FolderSource, proxyTextFetch, TextFetch } from './folder/source';
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
import { WINDOW_FROM, WINDOW_TO } from '../shared/ids';
import { limited, MODEL_CONCURRENCY } from '../vt/model/pool';
import type { Frame, SourceDecl } from '../vt/types';
import type { VisualTimelineOptions, VisualTimelineQuery, VisualTimelineVariableQuery } from './types';
import { VisualTimelineVariableSupport } from './variables';

/** Replaces dashboard variables in a query field (Grafana's template
 * service; injected so tests run without a Grafana runtime). */
export type Interpolate = (value: string, scopedVars?: ScopedVars) => string;
const grafanaInterpolate: Interpolate = (value, scopedVars) => getTemplateSrv().replace(value, scopedVars, 'csv');

/* The frontend-only data source. It answers panel queries with hosts and
 * their frames as rows (time, host, site, image), the way any data source
 * can (#126), feeds the Site and Host variables and the ad hoc filter bar,
 * from one of two connections:
 * - Demo data: built-in demo hosts, their pauses as state rows, and demo
 *   events for annotation queries;
 * - HTTP folder (#125): a web folder or public bucket of timestamped images,
 *   listed through the data source's proxy route.
 * The frames API mode of 1.x is gone (#126); its worker is read through a
 * stock data source such as Infinity. */
export class VisualTimelineDataSource extends DataSourceApi<VisualTimelineQuery, VisualTimelineOptions> {
  readonly demo: boolean;
  /** the HTTP folder connection, or null; folderError when its settings can't work */
  readonly folder: FolderSource | null = null;
  readonly folderError: string | null = null;

  constructor(
    instanceSettings: DataSourceInstanceSettings<VisualTimelineOptions>,
    private readonly interpolate: Interpolate = grafanaInterpolate,
    fetchText: TextFetch = proxyTextFetch(instanceSettings.uid)
  ) {
    super(instanceSettings);
    const o = instanceSettings.jsonData || {};
    const connection = o.connection ?? (o.demo === true ? 'demo' : undefined);
    this.demo = connection === 'demo';
    if (connection === 'folder') {
      try { this.folder = new FolderSource(o, fetchText); } catch (e) { this.folderError = (e as Error).message; }
    }
    this.variables = new VisualTimelineVariableSupport(this);
    // annotation queries: Demo data's demo events, as dashboard annotations
    this.annotations = { getDefaultQuery: () => ({ kind: 'annotations' }) };
  }

  /** Every source, or only those in `sites`. Demo sources depend on the time
   * window (their outages and eras sit inside it), so the window is passed
   * when there is one. Without Demo data there are none yet. */
  async sources(sites?: string[] | null, window?: { from: number; to: number }): Promise<SourceDecl[]> {
    if (this.demo) {return this.demoBackend(window).kiosks(sites ?? null) as SourceDecl[];}
    if (this.folder || this.folderError) {
      // a folder's hosts are the ones it holds frames for: in the window, or the last day
      const to = window?.to ?? Date.now();
      const { records } = await this.folderHosts(window?.from ?? to - 864e5, to, { sites: sites ?? null });
      return records.map(declOf);
    }
    return [];
  }

  private folderHosts(from: number, to: number, filters: { hosts?: string[] | null; sites?: string[] | null }) {
    if (!this.folder) {return Promise.reject(new Error(this.folderError || 'Set up the HTTP folder connection'));}
    return this.folder.hosts(from, to, filters);
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
    // the demo places its outage, pauses and pace change in the dashboard's
    // range: a panel asking for one slot again (M10) says which range that was
    const pf = Number(request.scopedVars?.[WINDOW_FROM]?.value), pt = Number(request.scopedVars?.[WINDOW_TO]?.value);
    const demoWindow = Number.isFinite(pf) && Number.isFinite(pt) && pt > pf ? { from: pf, to: pt } : window;
    const data = await Promise.all(
      request.targets
        .filter((t) => !t.hide)
        .map(async (t): Promise<DataFrame | DataFrame[]> => {
          if (t.kind === 'annotations') {
            return annotationsToFrame(this.demo ? this.demoBackend(demoWindow).annotations() : [], t.refId);
          }
          const sites = interpolatedList(this.field(t.sites, request.scopedVars));
          const hosts = interpolatedList(this.field(t.hosts, request.scopedVars));
          const tags = this.field(t.tags, request.scopedVars);
          if (!this.demo && (this.folder || this.folderError)) {
            return this.folderQuery(t, window, request, { sites, hosts, tags });
          }
          const sources = applySourceFilter(await this.sources(sites, this.demo ? demoWindow : window), {
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
              ? [list, await this.demoRecords(sources, window, request.maxDataPoints, t.refId, tz, demoWindow), pauseStatesToFrame(sources, t.refId)]
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

  /* An HTTP folder's answer: its hosts (a host table, for variables and
   * Table panels) and their frames as rows, one per step, with the large
   * image as each one's preview; or each host's last frame. A walk cut short
   * by its listing cap says so as a notice on the panel. */
  private async folderQuery(
    t: VisualTimelineQuery, window: { from: number; to: number }, request: DataQueryRequest<VisualTimelineQuery>,
    f: { sites: string[] | null; hosts: string[] | null; tags: string }
  ): Promise<DataFrame[]> {
    const { records, truncated } = await this.folderHosts(window.from, window.to, { sites: f.sites, hosts: f.hosts });
    const sources = applySourceFilter(records.map(declOf), {
      sites: f.sites, hosts: f.hosts, tags: /\$[{a-zA-Z_]/.test(f.tags) ? '' : f.tags, adhoc: request.filters,
    });
    const keep = new Set(sources.map((s) => s.site + '/' + s.id));
    const mine = records.filter((r) => keep.has(r.site + '/' + r.id));
    const notice = truncated
      ? [{ severity: 'warning' as const, text: 'The folder holds more than one query lists: some hosts or times weren\'t read. Narrow the time range or the hosts.' }]
      : [];
    if (t.lastFrame) {
      const backend = recordsBackend(mine);
      const end = Math.min(window.to, Date.now());
      const last = await Promise.all(limited(sources, MODEL_CONCURRENCY, (s) => lastFrameIn(s, window.from, end, backend).catch(() => null)));
      const frame = t.lastFrameFormat === 'host' ? lastFramesByHost(sources, last, t.refId) : sourcesToFrame(sources, t.refId, last);
      return [withNotices(frame, notice)];
    }
    return [withNotices(sourcesToFrame(sources, t.refId), notice), recordsToFrame(folderRows(mine, window, request.maxDataPoints), t.refId)];
  }

  /* Demo frames for these sources as rows. Each source's rows come at the
   * finest cadence it has in the window (source-3 changes pace mid-window),
   * or coarser for a long window, so there are never more rows per source
   * than the panel has pixels. */
  private async demoRecords(
    sources: SourceDecl[], window: { from: number; to: number }, maxDataPoints: number | undefined, refId: string, timeZone: string,
    demoWindow: { from: number; to: number } = window
  ) {
    const demo = this.demoBackend(demoWindow, timeZone);
    const span = Math.max(1, window.to - window.from);
    const rows: Array<{ ts: number; host: string; site: string; url: string; cadence: number; count?: number }> = [];
    for (const s of sources) {
      const cadences = [s.cadence, ...(s.history || []).map((h) => h.cadence)].filter((c): c is number => !!c && c > 0);
      const finest = Math.min(...cadences);
      const step = finest * Math.max(1, Math.ceil(span / (maxDataPoints || 1000) / finest));
      // each row carries the pace in force at its time, so a change of pace
      // reaches the panel as any query's would: as a cadence field that changes
      const paces = (s.history || []).filter((h) => h.cadence && (h.variant || 'lo') === 'lo').sort((a, b) => a.since - b.since);
      const paceAt = (ts: number) => paces.filter((h) => h.since <= ts).pop()?.cadence ?? s.cadence;
      for (const f of await demo.frames(s.site, s.id, window.from, window.to, step)) {
        // a row a step apart stands for the frames the host took in it
        const pace = paceAt(f.ts);
        const count = Math.max(1, Math.round(step / pace));
        rows.push({ ts: f.ts, host: s.id, site: s.site, url: f.url, cadence: pace, ...(count > 1 ? { count } : {}) });
      }
    }
    return recordsToFrame(rows, refId);
  }

  /** Values for a Site or Host dashboard variable. A plain-text query
   * ("sites" or "hosts") works too, for dashboards written by hand. */
  async metricFindQuery(
    query: VisualTimelineVariableQuery | string,
    options?: { scopedVars?: ScopedVars; range?: TimeRange }
  ): Promise<MetricFindValue[]> {
    const q: Partial<VisualTimelineVariableQuery> =
      typeof query === 'string' ? { type: query.trim().toLowerCase() === 'hosts' ? 'hosts' : 'sites' } : query;
    // a folder's hosts are the ones with frames in the dashboard's range
    const window = windowOf(options?.range);
    if (q.type === 'hosts') {
      const sites = interpolatedList(this.field(q.sites, options?.scopedVars));
      const sources = applySourceFilter(await this.sources(sites, window), { sites });
      return tagValues(sources, 'host').map((text) => ({ text, value: text }));
    }
    return tagValues(await this.sources(null, window), 'site').map((text) => ({ text, value: text }));
  }

  /** Keys for the ad hoc filter bar: site, host and every tag key among the
   * sources the other filters leave. */
  async getTagKeys(options?: DataSourceGetTagKeysOptions<VisualTimelineQuery>): Promise<MetricFindValue[]> {
    const sources = applySourceFilter(await this.sources(null, windowOf(options?.timeRange)), { adhoc: options?.filters });
    return tagKeys(sources).map((text) => ({ text }));
  }

  /** Values for one ad hoc key, among the sources the other filters leave. */
  async getTagValues(options: DataSourceGetTagValuesOptions<VisualTimelineQuery>): Promise<MetricFindValue[]> {
    const others = (options.filters || []).filter((f) => f.key !== options.key);
    const sources = applySourceFilter(await this.sources(null, windowOf(options.timeRange)), { adhoc: others });
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
    if (this.folder || this.folderError) {
      // read the last day, as a panel would: the settings, the proxy, the listing and the template at once
      try {
        const to = Date.now();
        const { records, truncated } = await this.folderHosts(to - 864e5, to, {});
        const frames = records.reduce((n, r) => n + r.frames.length, 0);
        if (!frames) {
          return { status: 'error', message: 'The folder answered, but no file in the last 24 hours matched the path template. Check the template, the listing format and the time zone.' };
        }
        const hosts = records.length;
        return { status: 'success', message: `Found ${frames} frame${frames === 1 ? '' : 's'} from ${hosts} host${hosts === 1 ? '' : 's'} in the last 24 hours` + (truncated ? ' (and more than one query lists).' : '.') };
      } catch (e) {
        return { status: 'error', message: (e as Error).message };
      }
    }
    return {
      status: 'error',
      message: 'Choose a connection: Demo data, or an HTTP folder. Panels can also read frames from any data source that returns rows of time, image and host.',
    };
  }

}

/* a folder host as a source declaration */
const declOf = (r: HostRecords): SourceDecl => ({ id: r.id, site: r.site, cadence: r.cadence, ...(r.inferred ? { inferred: true } : {}) });

/* A folder's frames as rows: one per step for each host, at its own cadence
 * or coarser, so no more rows than the panel has pixels (maxDataPoints).
 * Each row says how many frames it stands for (frame_count): the panel
 * shows "4 frames" on a slot, and fetches a slot's frames again, at full
 * resolution, when the preview player or the hover flipbook plays them
 * (M10). Plus the frame in force at the window's start. */
function folderRows(records: HostRecords[], window: { from: number; to: number }, maxDataPoints: number | undefined) {
  const span = Math.max(1, window.to - window.from);
  const rows: Array<{ ts: number; host: string; site: string; url: string; hi?: string; count?: number }> = [];
  for (const r of records) {
    const inWindow = r.frames.filter((f) => f.ts >= window.from && f.ts <= window.to);
    const points = Math.max(1, maxDataPoints || 1000);
    // few enough: every one; else a whole number of the host's cadence per row
    const kept = inWindow.length <= points ? inWindow
      : thinWithCounts(r.frames, window.from, window.to, r.cadence * Math.max(1, Math.ceil(span / points / r.cadence)));
    let before: Frame | undefined;
    for (const f of r.frames) {if (f.ts < window.from) {before = f;}}
    for (const f of before ? [before, ...kept] : kept) {
      rows.push({ ts: f.ts, host: r.id, site: r.site, url: f.url, ...(f.hi ? { hi: f.hi } : {}), ...(f.count ? { count: f.count } : {}) });
    }
  }
  return rows;
}

const withNotices = (frame: DataFrame, notices: Array<{ severity: 'warning'; text: string }>): DataFrame =>
  notices.length ? { ...frame, meta: { ...(frame.meta || {}), notices } } : frame;

/* a dashboard time range as a window, when there is one */
const windowOf = (r?: TimeRange) => (r ? { from: r.from.valueOf(), to: r.to.valueOf() } : undefined);
