import { type DataFrame, type DataQueryRequest, type DataQueryResponse, dateTime, type ScopedVars } from '@grafana/data';
import type { DataQuery } from '@grafana/schema';
import { getDataSourceSrv } from '@grafana/runtime';
import { isObservable, lastValueFrom, type Observable } from 'rxjs';

import { type FieldRoles, recordsFromSeries } from '../shared/frameRecords';
import type { Frame } from '../vt/types';
import { WINDOW_FROM, WINDOW_TO } from '../shared/ids';

/* A slot's frames at full resolution, from any data source (M10): the panel
 * runs its own queries again, as Grafana handed them to it, for just the
 * slot's span. A data source that thins to the panel's width (ours, SQL with
 * $__interval) answers a span that short with every frame. Asked only when
 * the preview player or the hover flipbook plays a slot: a click, or a
 * deliberate rest. */

/** At most this many points per series for a span when the caller sets no
 * limit: enough that a short span is never thinned. */
const DETAIL_POINTS = 10000;
/** Answers kept for a while: a slot played twice asks once. */
const CACHE_SIZE = 50;

type Query = (req: DataQueryRequest<DataQuery>) => Promise<DataQueryResponse> | Observable<DataQueryResponse>;

/** A Backend.detail over the panel's latest request (read through `latest`,
 * so it never goes stale and never changes identity). */
export function makeDetail(latest: () => DataQueryRequest<DataQuery> | undefined, roles: () => FieldRoles) {
  const cache = new Map<string, Promise<Frame[]>>();
  return (site: string, id: string, from: number, to: number, maxPoints?: number): Promise<Frame[]> => {
    const request = latest();
    if (!request) {return Promise.resolve([]);}
    const points = Math.max(1, Math.min(DETAIL_POINTS, Math.floor(maxPoints ?? DETAIL_POINTS)));
    const key = [request.requestId, site, id, from, to, points].join('|');
    const hit = cache.get(key);
    if (hit) {return hit;}
    const p = (async () => {
      const series = await runFor(request, from, to, points);
      const hosts = recordsFromSeries(series, roles()) ?? [];
      const h = hosts.find((r) => r.id === id && (r.site === site || !site || !r.site));
      return (h?.frames ?? []).filter((f) => f.ts >= from && f.ts <= to);
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > CACHE_SIZE) {cache.delete(cache.keys().next().value!);}
    return p;
  };
}

/* the request's queries for [from, to], each against its own data source (a
 * Mixed panel's queries name theirs); hidden ones are left out */
async function runFor(request: DataQueryRequest<DataQuery>, from: number, to: number, points: number): Promise<DataFrame[]> {
  // as many points as asked for, as Grafana would ask a panel that wide: max
  // data points, and $__interval to match (the reference worker's step)
  const intervalMs = Math.max(1, Math.ceil((to - from) / points));
  const range = { from: dateTime(from), to: dateTime(to), raw: { from: dateTime(from), to: dateTime(to) } };
  // ${__from} and ${__to} in a query (Infinity's URLs, say) name the span
  // too; the dashboard's own range rides along, for a source whose answer
  // depends on it (our demo data places its outage and pauses in it)
  const parentFrom = request.range.from.valueOf(), parentTo = request.range.to.valueOf();
  const scopedVars: ScopedVars = {
    ...request.scopedVars,
    __from: { text: String(from), value: from },
    __to: { text: String(to), value: to },
    __interval: { text: intervalMs + 'ms', value: intervalMs + 'ms' },
    __interval_ms: { text: String(intervalMs), value: intervalMs },
    [WINDOW_FROM]: { text: String(parentFrom), value: parentFrom },
    [WINDOW_TO]: { text: String(parentTo), value: parentTo },
  };
  const groups = new Map<string, DataQuery[]>();
  for (const t of request.targets) {
    if (t.hide) {continue;}
    const uid = t.datasource?.uid ?? '';
    groups.set(uid, [...(groups.get(uid) ?? []), t]);
  }
  const out: DataFrame[] = [];
  let n = 0;
  for (const [uid, targets] of groups) {
    try {
      const ds = await getDataSourceSrv().get(uid ? { uid, type: targets[0].datasource?.type } : undefined, scopedVars);
      const req: DataQueryRequest<DataQuery> = {
        ...request, targets, range, rangeRaw: range.raw, scopedVars,
        maxDataPoints: points, interval: intervalMs + 'ms', intervalMs,
        requestId: request.requestId + '-detail-' + n++, startTime: Date.now(),
      };
      const res = (ds.query as unknown as Query)(req);
      const answer = isObservable(res) ? await lastValueFrom(res) : await res;
      out.push(...((answer?.data ?? []) as DataFrame[]));
    } catch (e) {
      console.warn('[visual-timeline] fetching a slot\'s frames failed:', e);
    }
  }
  return out;
}
