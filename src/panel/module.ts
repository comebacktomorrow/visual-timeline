import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  locationUtil,
  rangeUtil,
  dateTimeFormat,
  DataHoverClearEvent,
  DataHoverEvent,
  LoadingState,
  PanelPlugin,
  PanelProps,
  systemDateFormats,
} from '@grafana/data';
import { config, getDataSourceSrv, locationService } from '@grafana/runtime';
import { usePanelContext, useTheme2 } from '@grafana/ui';
import { mountTimeline, mountGrid } from '../core';
import type { AxisFormatter } from '../vt/time/ticks';
import type { HoldLimit } from '../vt/model/intervals';
import { themeVars } from '../theme';
import { coreTimeZone } from '../timezone';
import { DATASOURCE_ID } from '../shared/ids';
import { FieldRoles, hostTableFromSeries, recordsBackend, recordsFromSeries } from '../shared/frameRecords';
import { stateAnnotations, statesFromSeries } from '../shared/hostState';
import { needsRebuild } from './resize';
import { makeDetail } from './detail';
import { FRAME_WIDTH } from '../vt/ui/frameWidth';
import { chipLinkUrl, parseChips } from './chips';
import { extractAnnotations } from './annotations';
import { emptyStateText } from './emptyState';
import { fieldConfig, panelOptions, type VisualTimelineOptions } from './options';

/* a duration option ("90s", "10m") in ms; 0 when it doesn't parse */
function safeInterval(v: string): number {
  try { return rangeUtil.intervalToMs(v.trim()); } catch { return 0; }
}

/** How long a resized panel's width must hold before the core rebuilds. */
const RESIZE_SETTLE_MS = 250;

interface MountInstance {
  setExternalCursor: (t: number) => void;
  clearExternal?: () => void;
  isHovering?: () => boolean;
  destroy: () => void;
}

const TimelinePanel: React.FC<PanelProps<VisualTimelineOptions>> = (props) => {
  const ref = useRef<HTMLDivElement>(null);
  const instRef = useRef<MountInstance | null>(null);
  const localHoverRef = useRef(false);
  // the core's palette, from the active theme: set inline on the mount
  // root, so a live theme switch re-renders the vars without a remount
  const theme = useTheme2();
  const palette = useMemo(() => themeVars(theme), [theme]);

  const from = props.timeRange.from.valueOf();
  const to = props.timeRange.to.valueOf();
  const options = props.options || {};
  const mode = options.mode || 'timeline';
  const follow = options.followCrosshair !== false;
  const fit = options.imageFit || 'fit';
  const showDetails = options.showDetails === true;
  const hideEmpty = options.hideEmpty === true;
  const showAnnotations = options.showAnnotations !== false;
  // the interval Grafana asked the queries for at: a data source may answer
  // one frame per it (the reference worker's step=$__interval_ms), or per
  // the range over max data points (ours), before Grafana rounds it
  const req = props.data?.request;
  const reqSpan = req ? req.range.to.valueOf() - req.range.from.valueOf() : 0;
  const sampleInterval = Math.max(req?.intervalMs ?? 0, req?.maxDataPoints ? Math.ceil(reqSpan / req.maxDataPoints) : 0);
  // a promise for every host, whatever its data says (ms; 0: none)
  const expectedCadence = options.expectedCadence ? safeInterval(options.expectedCadence) : 0;
  // frames without a promise: how long one is shown when none follows soon
  const hold: HoldLimit = options.holdFrames === 'next' || options.holdFrames === 'always' ? 'none'
    : options.holdFrames === 'limit' || options.holdFrames === 'threshold' ? safeInterval(options.holdFor || '10m') || 'auto' : 'auto';
  /* Host state (#126, M4): rows with a time, a host and a state value, from
   * any query; labels and colours from the field's value mappings. A state
   * field set to "Pauses frames" explains the frames a host doesn't send;
   * the others ride along as annotations on their host (M4b). */
  const states = statesFromSeries(props.data?.series, theme, { time: options.timeField, host: options.hostField, site: options.siteField, state: options.stateField });
  const statesKey = states ? JSON.stringify(states) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const statesMemo = useMemo(() => states, [statesKey]);
  const annotations = showAnnotations
    ? [...extractAnnotations(props.data?.annotations as any[]), ...stateAnnotations(statesMemo ?? [], from, to)]
    : [];
  // remount only when annotation CONTENT changes, not on every data-object identity flip
  const annKey = JSON.stringify(annotations);
  const timeZone = coreTimeZone(props.timeZone);
  // axis labels in Grafana's own formats (systemDateFormats.interval, which
  // an instance can configure), as its time series panel draws them
  const axisFormat = useMemo<AxisFormatter>(
    () => (ts, kind) => dateTimeFormat(ts, { format: systemDateFormats.interval[kind], timeZone: props.timeZone }),
    [props.timeZone]
  );

  /* Frame records: rows with a time, an image and a host, from any data
   * source (#126). When the query returns any, they are what the panel
   * draws; a Visual Timeline source list in the same result adds what it
   * knows about each host (history, time zone, tags). */
  const roles: FieldRoles = {
    time: options.timeField, image: options.imageField, host: options.hostField,
    site: options.siteField, preview: options.previewField, cadence: options.cadenceField, video: options.videoField,
  };
  const records = recordsFromSeries(props.data?.series, roles);
  // keyed on content, as above: a host's frames only ever grow, so its count
  // and newest frame say whether anything changed
  const recordsKey = records
    ? JSON.stringify(records.map((h) => [h.site, h.id, h.cadence, h.frames.length, h.frames[0]?.ts, h.frames.at(-1)?.ts, h.frames.at(-1)?.url,
      // and its clips (M10c): a new one can come with no new frame
      h.clips?.length ?? 0, h.clips?.at(-1)?.from, h.clips?.at(-1)?.to]))
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recordsMemo = useMemo(() => records, [recordsKey]);
  // a source list without records (no frames in the window) still draws its
  // hosts: a host that was silent the whole time is information
  /* A host table (M4c): rows of a host and what's known about it (time
   * zone, location, tags, cadence) from any query, such as the worker's
   * /sources through Infinity. Its hosts are drawn even without frames. */
  const table = hostTableFromSeries(props.data?.series, roles);
  const tableKey = table.length ? JSON.stringify(table) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tableMemo = useMemo(() => table, [tableKey]);
  /* A slot's frames at full resolution, by running the panel's queries again
   * for just that slot (M10, detail.ts): read through refs, so the backend
   * keeps its identity across refreshes. */
  const requestRef = useRef(props.data?.request);
  requestRef.current = props.data?.request;
  const rolesRef = useRef(roles);
  rolesRef.current = roles;
  const detail = useMemo(() => makeDetail(() => requestRef.current as never, () => rolesRef.current), []);
  const backend = useMemo(
    () => (recordsMemo || statesMemo || tableMemo.length
      ? { ...recordsBackend(recordsMemo ?? [], tableMemo, statesMemo ?? []), detail }
      : null),
    [recordsMemo, statesMemo, tableMemo, detail]
  );
  /* Clicking a host, site or tag chip adds that filter to the dashboard's ad
   * hoc filter for this data source, as a table cell's "filter for value"
   * does. Grafana leaves onAddAdHocFilter unset where it can't do that. */
  const { onAddAdHocFilter } = usePanelContext();
  // the context can hand over a new function on any render: keep the latest
  // in a ref, so only "can filter at all" affects the mount (a new function
  // must not tear down and rebuild the timeline)
  const addFilterRef = useRef(onAddAdHocFilter);
  addFilterRef.current = onAddAdHocFilter;
  const canFilter = !!onAddAdHocFilter;
  /* What a header chip does when clicked (Chip click): add an ad hoc filter
   * (where Grafana can), follow a link with the chip's key, value and host,
   * or nothing (the chips are then plain text). */
  const chipClick = options.chipClick || 'filter';
  const chipLink = options.chipLink || '';
  const replaceRef = useRef(props.replaceVariables);
  replaceRef.current = props.replaceVariables;
  const onFilter = useMemo(() => {
    if (chipClick === 'none') {return undefined;}
    if (chipClick === 'link') {
      if (!chipLink) {return undefined;}
      return (key: string, value: string, host?: string) => {
        const url = replaceRef.current(chipLinkUrl(chipLink, key, value, host));
        // another site in a new tab; this Grafana's own pages in place
        if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {window.open(url, '_blank', 'noopener');}
        else {locationService.push(locationUtil.stripBaseFromUrl(url));}
      };
    }
    return canFilter ? (key: string, value: string) => addFilterRef.current?.({ key, value, operator: '=' }) : undefined;
  }, [canFilter, chipClick, chipLink]);
  const chips = parseChips(options.chips);
  const chipsKey = chips ? chips.join(',') : '';
  /* The width the core builds for. Slot counts and axis ticks depend on it,
   * so a new width needs a rebuild, and a rebuild refetches every source's
   * frames. While a panel is being resized Grafana reports a new width many
   * times a second: build once it has been steady for RESIZE_SETTLE_MS, and
   * leave the current view up (it stretches with the panel) until then.
   * Height needs no rebuild: the layout follows it. */
  const [buildWidth, setBuildWidth] = useState(props.width);
  useEffect(() => {
    if (!needsRebuild(buildWidth, props.width)) {
      return;
    }
    const t = setTimeout(() => setBuildWidth(props.width), RESIZE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [props.width, buildWidth]);
  const loading = props.data?.state === LoadingState.Loading;
  const failed = props.data?.state === LoadingState.Error;
  // anything that names a host: frame rows, a source list, a host table, or
  // a pause state (a host paused all window has nothing else)
  const showFrames = !!backend && ((recordsMemo?.length ?? 0) > 0 || tableMemo.length > 0 ||
    !!statesMemo?.some((h) => h.spans.some((sp) => sp.pauses)));

  useEffect(() => {
    if (!ref.current || !showFrames || !backend) {
      return;
    }
    const common = {
      from, to, width: buildWidth, fit, backend, showDetails, hideEmpty, onFilter,
      annotations, showAnnotations, annotationLanes: options.annotationLanes || 'shared',
      hold, chips, ...(expectedCadence > 0 ? { expectedCadence } : {}),
      ...(sampleInterval > 0 ? { sampleInterval } : {}),
      playerScrubber: options.playerScrubber || 'ticks',
      frameWidth: options.frameWidth || FRAME_WIDTH,
      videoLine: !!options.showVideoLine,
      videoAutoSpeed: !!options.videoAutoSpeed,
      headerMode: options.headerMode || 'bar',
      thumbTimes: options.thumbTimes === 'source' ? 'source' : 'panel',
      timeZone,
      axisFormat,
    };
    const inst: MountInstance =
      mode === 'grid'
        ? mountGrid(ref.current, common)
        : mountTimeline(ref.current, {
            ...common,
            onHover: (t: number) => {
              localHoverRef.current = true;
              props.eventBus.publish(new DataHoverEvent({ point: { time: t } } as any));
              localHoverRef.current = false;
            },
            onHoverClear: () => props.eventBus.publish(new DataHoverClearEvent()),
            onZoom: (zFrom: number, zTo: number) => {
              if (props.onChangeTimeRange) {
                props.onChangeTimeRange({ from: zFrom, to: zTo });
              }
            },
          });
    instRef.current = inst;
    return () => {
      instRef.current = null;
      inst.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFrames, backend, onFilter, mode, fit, showDetails, hideEmpty, from, to, buildWidth, annKey, options.annotationLanes, options.headerMode, options.thumbTimes, timeZone, axisFormat, hold, expectedCadence, sampleInterval, options.playerScrubber, options.frameWidth, options.showVideoLine, options.videoAutoSpeed, chipsKey]);

  useEffect(() => {
    const subs = [
      props.eventBus.subscribe(DataHoverEvent, (ev) => {
        if (localHoverRef.current) {
          return; // our own publish echoing back
        }
        const t = ev.payload && ev.payload.point && (ev.payload.point.time as number | undefined);
        if (t == null || !instRef.current) {
          return;
        }
        if (mode === 'grid' && !follow) {
          return;
        }
        // while the user hovers OUR strips, our mouse is authoritative —
        // other panels re-emit hover events that would fight the cursor
        if (instRef.current.isHovering && instRef.current.isHovering()) {
          return;
        }
        instRef.current.setExternalCursor(t);
      }),
      props.eventBus.subscribe(DataHoverClearEvent, () => {
        if (instRef.current && instRef.current.clearExternal) {
          instRef.current.clearExternal();
        }
      }),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
     
  }, [props.eventBus, mode, follow]);

  if (!showFrames) {
    // still loading, or failed (Grafana shows the error itself): nothing to say yet
    if (loading || failed) {
      return React.createElement('div', { style: { width: '100%', height: '100%' } });
    }
    const user = config.bootData?.user;
    const canCreate = !!user && (user.orgRole === 'Admin' || user.isGrafanaAdmin === true);
    const count = getDataSourceSrv().getList({ pluginId: DATASOURCE_ID }).length;
    const hasData = (props.data?.series || []).some((f) => f.length > 0);
    const text = emptyStateText(tableMemo.length > 0 || !!recordsMemo, count, canCreate, hasData);
    const link = text.link
      ? React.createElement(
          'div',
          null,
          React.createElement(
            'a',
            { href: `${config.appSubUrl || ''}/connections/datasources/new`, style: { color: theme.colors.text.link } },
            text.link.text
          ),
          text.link.after
        )
      : null;
    return React.createElement(
      'div',
      {
        'data-testid': 'vt-empty-state',
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing(0.5),
          padding: theme.spacing(2),
          textAlign: 'center',
          color: theme.colors.text.secondary,
        } as React.CSSProperties,
      },
      ...text.lines.map((line, i) =>
        React.createElement('div', { key: i, style: i === 0 ? { color: theme.colors.text.primary } : undefined }, line)
      ),
      link
    );
  }

  return React.createElement('div', {
    ref,
    style: { width: '100%', height: '100%', overflow: 'hidden', ...palette } as React.CSSProperties,
  });
};

export const plugin = new PanelPlugin<VisualTimelineOptions>(TimelinePanel)
  // without this Grafana strips annotations out of PanelData before the
  // panel sees them — declaring support is what turns the stream on
  .setDataSupport({ annotations: true })
  .useFieldConfig(fieldConfig)
  .setPanelOptions(panelOptions);
