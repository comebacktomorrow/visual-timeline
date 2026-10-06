import React, { useEffect, useMemo, useRef } from 'react';
import { dateTimeFormat, PanelPlugin, PanelProps, DataHoverEvent, DataHoverClearEvent, systemDateFormats } from '@grafana/data';
import { config, getDataSourceSrv, locationService } from '@grafana/runtime';
import { useTheme2 } from '@grafana/ui';
import { mountTimeline, mountGrid } from '../core';
import type { AxisFormatter } from '../vt/time/ticks';
import { themeVars } from '../theme';
import { coreTimeZone } from '../timezone';
import { backendRequest } from '../shared/backendRequest';
import { DATASOURCE_ID } from '../shared/proxy';
import { ConnectionState, dataSourceOptions, pickDataSource, resolveConnection } from './connection';

interface VisualTimelineOptions {
  datasourceUid?: string;
  apiUrl?: string;
  apiKey?: string;   // removed option; older dashboards may still carry it (see connection.ts)
  sites?: string;
  mode?: 'timeline' | 'grid';
  followCrosshair?: boolean;
  imageFit?: 'fit' | 'fill';
  showDetails?: boolean;
  hideEmpty?: boolean;
  tagFilter?: string;
  showAnnotations?: boolean;
  annotationLanes?: 'shared' | 'per-source';
  headerMode?: 'bar' | 'inline' | 'inline-gradient';
  thumbTimes?: 'panel' | 'source';
}

interface PanelAnnotation {
  ts: number;
  timeEnd?: number;
  title?: string;
  text?: string;
  tags?: string[] | string;
  color?: string;
}

/* Flatten the dashboard's annotation frames (whatever data sources its
 * annotation queries run on — the built-in store, alerts, Loki, anything)
 * into plain objects for the core. The panel is only a renderer here. */
function extractAnnotations(frames: any[] | undefined): PanelAnnotation[] {
  const out: PanelAnnotation[] = [];
  for (const frame of frames || []) {
    const field = (name: string) => (frame.fields || []).find((f: any) => f.name === name);
    const val = (f: any, i: number) =>
      f ? (typeof f.values?.get === 'function' ? f.values.get(i) : f.values?.[i]) : undefined;
    const time = field('time');
    if (!time) {continue;}
    const timeEnd = field('timeEnd');
    const title = field('title');
    const text = field('text');
    const tags = field('tags');
    const color = field('color');
    const n = frame.length ?? (typeof time.values?.length === 'number' ? time.values.length : 0);
    for (let i = 0; i < n; i++) {
      out.push({
        ts: val(time, i),
        timeEnd: val(timeEnd, i),
        title: val(title, i),
        text: val(text, i),
        tags: val(tags, i),
        color: val(color, i),
      });
    }
  }
  return out;
}

/* What a panel that can't show frames says instead, and where it points. */
function emptyStateText(state: ConnectionState, dataSourceCount: number, canCreate: boolean) {
  if (state === 'missing') {
    return { lines: ["This panel's data source no longer exists.", "Select another in the panel's Data source option."] };
  }
  if (dataSourceCount > 0) {
    return { lines: ['No data source selected.', "Select a Visual Timeline data source in the panel's Data source option."] };
  }
  return canCreate
    ? {
        lines: ['No Visual Timeline data source yet.'],
        link: { text: 'Add one', after: ' (turn on its Demo data to try the panel without an API).' },
      }
    : { lines: ['No Visual Timeline data source yet.', 'Ask a Grafana admin to add one.'] };
}

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
  /* The site expression lives in a panel OPTION (persisted in panel JSON)
   * so Grafana's variable-dependency scan sees it and refreshes this panel
   * on variable change — resolving it only via replaceVariables() would be
   * invisible to the scanner and the panel would go stale until refresh. */
  const siteExpr = options.sites || '${site:csv}';
  const siteRaw = props.replaceVariables ? props.replaceVariables(siteExpr) : '';
  // a dashboard WITHOUT the variable leaves the expression literal — that
  // must mean "all sites", not "filter to a site named ${site:csv}" (a
  // fresh dashboard would otherwise render an axis and zero cards)
  const site = /\$[{a-zA-Z_]/.test(siteRaw) ? '' : siteRaw;
  const mode = options.mode || 'timeline';
  const follow = options.followCrosshair !== false;
  const fit = options.imageFit || 'fit';
  // a Visual Timeline API data source (token server-side; or demo data, if
  // it has Demo data on), else the API URL option for an open API, else
  // nothing yet — see connection.ts
  const datasourceUid = (options.datasourceUid || '').trim();
  const { state, apiUrl, apiFetch, authHint } = useMemo(
    () => resolveConnection(options, (uid) => getDataSourceSrv().getInstanceSettings(uid)?.jsonData, backendRequest),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datasourceUid, options.apiUrl, options.apiKey]
  );
  const showDetails = options.showDetails === true;
  const hideEmpty = options.hideEmpty === true;
  const tagFilter = (options.tagFilter || '').trim();
  const showAnnotations = options.showAnnotations !== false;
  const annotations = showAnnotations ? extractAnnotations(props.data?.annotations as any[]) : [];
  // remount only when annotation CONTENT changes, not on every data-object identity flip
  const annKey = JSON.stringify(annotations);
  const timeZone = coreTimeZone(props.timeZone);
  // axis labels in Grafana's own formats (systemDateFormats.interval, which
  // an instance can configure), as its time series panel draws them
  const axisFormat = useMemo<AxisFormatter>(
    () => (ts, kind) => dateTimeFormat(ts, { format: systemDateFormats.interval[kind], timeZone: props.timeZone }),
    [props.timeZone]
  );

  const visualTimelineSources = getDataSourceSrv().getList({ pluginId: DATASOURCE_ID, all: true });
  /* A panel with nothing selected takes the obvious data source while it is
   * being created or edited (the only one, or Grafana's default among
   * several), the way Grafana fills in a new panel's data source. The choice
   * is saved with the panel; a saved panel is never re-pointed on load, so a
   * second data source added later can't change what existing panels show. */
  const editing = locationService.getSearchObject().editPanel !== undefined;
  const autoPick = state === 'none' && editing ? pickDataSource(visualTimelineSources) : undefined;
  useEffect(() => {
    if (autoPick) {
      props.onOptionsChange({ ...options, datasourceUid: autoPick });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPick]);
  const showFrames = state === 'api' || state === 'demo';

  useEffect(() => {
    if (!ref.current || !showFrames) {
      return;
    }
    const common = {
      site, from, to, width: props.width, fit, apiUrl, apiFetch, authHint, showDetails, hideEmpty, tagFilter,
      annotations, showAnnotations, annotationLanes: options.annotationLanes || 'shared',
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
  }, [showFrames, mode, fit, apiUrl, apiFetch, authHint, showDetails, hideEmpty, tagFilter, site, from, to, props.width, props.height, annKey, options.annotationLanes, options.headerMode, options.thumbTimes, timeZone, axisFormat]);

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
    const user = config.bootData?.user;
    const canCreate = !!user && (user.orgRole === 'Admin' || user.isGrafanaAdmin === true);
    const text = emptyStateText(state, visualTimelineSources.length, canCreate);
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
  .setPanelOptions((builder) => {
  builder
    .addSelect({
      path: 'datasourceUid',
      name: 'Data source',
      description:
        'A Visual Timeline API data source: it holds the API URL and the viewer token in Grafana\'s server-side settings, and API calls go through Grafana, so the token is never in the dashboard JSON or the browser. A data source with Demo data on shows built-in demo sources. Replaces the API URL option below.',
      settings: {
        options: [],
        // all: Grafana's pickers otherwise skip data sources that serve no
        // queries, and this one only proxies (plugin.json: metrics false)
        getOptions: async () => dataSourceOptions(getDataSourceSrv().getList({ pluginId: DATASOURCE_ID, all: true })),
        isClearable: true,
      },
    })
    .addTextInput({
      path: 'apiUrl',
      name: 'API URL',
      description: 'Frames API base URL (see docs/API.md in the repository), for an API with open reads. An API that needs a viewer token connects through a data source instead. Ignored when a data source is selected.',
      defaultValue: '',
      showIf: (o) => !o.datasourceUid,
    })
    .addTextInput({
      path: 'sites',
      name: 'Sites',
      description:
        'Site filter expression, e.g. ${site:csv} or a literal site id. Keep the variable here so Grafana refreshes the panel when it changes.',
      defaultValue: '${site:csv}',
    })
    .addRadio({
      path: 'mode',
      name: 'Display mode',
      defaultValue: 'timeline',
      settings: {
        options: [
          { value: 'timeline', label: 'Timeline' },
          { value: 'grid', label: 'Multiview grid' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'followCrosshair',
      name: 'Follow shared crosshair',
      description:
        'Show the frame at the crosshair time from other panels; otherwise the most recent frame in range',
      defaultValue: true,
      showIf: (o) => o.mode === 'grid',
    })
    .addBooleanSwitch({
      path: 'showAnnotations',
      name: 'Show annotations',
      description:
        'Render the dashboard\'s annotations on the timeline: source:<id>-tagged ones as diamonds on that source\'s strip, others on a shared lane; regions shade their span. Data comes from the dashboard\'s annotation queries (any data source).',
      defaultValue: true,
      showIf: (o) => o.mode !== 'grid',
    })
    .addRadio({
      path: 'annotationLanes',
      name: 'Annotation lanes',
      description:
        'Shared: untagged annotations collapse onto one lane above the axis. Per source: every source gets its own lane under its strip, carrying its events plus the globals — easier to read with many stacked timelines.',
      defaultValue: 'shared',
      settings: {
        options: [
          { value: 'shared', label: 'Shared lane' },
          { value: 'per-source', label: 'Per source' },
        ],
      },
      showIf: (o) => o.mode !== 'grid' && o.showAnnotations !== false,
    })
    .addBooleanSwitch({
      path: 'hideEmpty',
      name: 'Hide sources with no data in window',
      description: 'Sources with zero frames in the current time range are omitted instead of shown as offline',
      defaultValue: false,
    })
    .addTextInput({
      path: 'tagFilter',
      name: 'Tag filter',
      description: 'Only show sources whose declared tags match ALL pairs, e.g. env=prod, room=lobby',
      defaultValue: '',
    })
    .addBooleanSwitch({
      path: 'showDetails',
      name: 'Show cadence details',
      description: 'Per-source capture cadence and display resolution (debug/tuning info)',
      defaultValue: false,
    })
    .addRadio({
      path: 'headerMode',
      name: 'Header',
      description:
        'Bar: each source gets a header row above its strip/tile. Inline: hostname and details float over the image\'s top-left as chip bubbles on two lines — buys back vertical space. Gradient adds a left-to-right fade behind them for busy frames.',
      defaultValue: 'bar',
      settings: {
        options: [
          { value: 'bar', label: 'Bar' },
          { value: 'inline', label: 'Inline' },
          { value: 'inline-gradient', label: 'Inline · gradient' },
        ],
      },
    })
    .addRadio({
      path: 'thumbTimes',
      name: 'Thumbnail times',
      description:
        'Which clock a source\'s own times use: thumbnail timestamps, magnifier and preview captions, and last-seen/expected messages. Source local time uses the zone the source declares (X-Timezone) and marks each time with its offset from the dashboard, e.g. 07:31:00 (+3h); sources without a declared zone keep dashboard time. The time axis and crosshair always use the dashboard time zone.',
      defaultValue: 'panel',
      settings: {
        options: [
          { value: 'panel', label: 'Dashboard time' },
          { value: 'source', label: 'Source local time' },
        ],
      },
    })
    .addRadio({
      path: 'imageFit',
      name: 'Image fit',
      description: 'Fit letterboxes the whole frame; fill crops to cover. Never stretches.',
      defaultValue: 'fit',
      settings: {
        options: [
          { value: 'fit', label: 'Fit' },
          { value: 'fill', label: 'Fill' },
        ],
      },
    });
  });
