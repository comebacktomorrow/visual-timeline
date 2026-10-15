import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  dateTimeFormat,
  DataHoverClearEvent,
  DataHoverEvent,
  LoadingState,
  PanelPlugin,
  PanelProps,
  systemDateFormats,
} from '@grafana/data';
import { config, getDataSourceSrv } from '@grafana/runtime';
import { usePanelContext, useTheme2 } from '@grafana/ui';
import { mountTimeline, mountGrid, resolveTimeZone } from '../core';
import type { AxisFormatter } from '../vt/time/ticks';
import { makeBackend as makeDemoBackend } from '../vt/backends/demo';
import type { Backend, Frame, SourceDecl } from '../vt/types';
import { themeVars } from '../theme';
import { coreTimeZone } from '../timezone';
import { DATASOURCE_ID } from '../shared/proxy';
import { SourcesFrameMeta, sourcesFromFrames } from '../shared/sources';
import { needsRebuild } from './resize';

interface VisualTimelineOptions {
  mode?: 'timeline' | 'grid';
  followCrosshair?: boolean;
  imageFit?: 'fit' | 'fill';
  showDetails?: boolean;
  hideEmpty?: boolean;
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

/** How long a resized panel's width must hold before the core rebuilds. */
const RESIZE_SETTLE_MS = 250;
/** The data source method the panel calls for each source's frames. */
interface FramesSource {
  frames(site: string, id: string, from: number, to: number, step: number): Promise<Frame[]>;
}

/* The core's data layer for one query result. The sources come from the
 * data source's answer, already filtered by the panel's query, the dashboard
 * variables and the ad hoc filters. Frames come through the same data
 * source; with Demo data on, from the core's built-in demo for this window. */
function panelBackend(sources: SourceDecl[], meta: SourcesFrameMeta, from: number, to: number, tz: string): Backend {
  if (meta.demo) {
    const demo = makeDemoBackend({ from, to }, Math.max(1, to - from), tz);
    return { kiosks: () => sources, frames: demo.frames, annotations: demo.annotations };
  }
  let ds: Promise<FramesSource> | null = null;
  return {
    kiosks: () => sources,
    frames: async (site, id, f, t, step) => {
      ds ??= getDataSourceSrv().get({ uid: meta.uid }) as unknown as Promise<FramesSource>;
      return (await ds).frames(site, id, f, t, step);
    },
  };
}

/* What a panel that can't draw says instead. Errors from the data source
 * aren't repeated here: Grafana shows them in the panel's error indicator. */
function emptyStateText(hasSources: boolean, dataSourceCount: number, canCreate: boolean) {
  if (hasSources) {
    return { lines: ['No sources match.', "Check this panel's query (Sites, Hosts, Tags) and the dashboard's filters."] };
  }
  if (dataSourceCount > 0) {
    return { lines: ['No Visual Timeline data source in this panel.', 'Choose one in the Query tab.'] };
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
  const mode = options.mode || 'timeline';
  const follow = options.followCrosshair !== false;
  const fit = options.imageFit || 'fit';
  const showDetails = options.showDetails === true;
  const hideEmpty = options.hideEmpty === true;
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

  /* The sources, from this panel's query result (see shared/sources.ts).
   * The core remounts, fetching frames again, when the sources change (a
   * variable or filter change) or the time window moves (every refresh of a
   * relative range). A refresh that changes neither keeps the view: frames
   * are immutable, and the core polls the live edge itself. */
  // keyed on content: Grafana can hand over a new copy of the same result
  // (the panel editor does), and only a real change should remount the core
  const parsed = sourcesFromFrames(props.data?.series);
  const resultKey = parsed ? JSON.stringify(parsed) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => parsed, [resultKey]);
  const backend = useMemo(
    () => (result ? panelBackend(result.sources, result.meta, from, to, resolveTimeZone(timeZone)) : null),
    [result, from, to, timeZone]
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
  const onFilter = useMemo(
    () =>
      canFilter
        ? (key: string, value: string) => addFilterRef.current?.({ key, value, operator: '=' })
        : undefined,
    [canFilter]
  );
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
  const showFrames = !!backend && result!.sources.length > 0;

  useEffect(() => {
    if (!ref.current || !showFrames || !backend) {
      return;
    }
    const common = {
      from, to, width: buildWidth, fit, backend, showDetails, hideEmpty, onFilter,
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
  }, [showFrames, backend, onFilter, mode, fit, showDetails, hideEmpty, from, to, buildWidth, annKey, options.annotationLanes, options.headerMode, options.thumbTimes, timeZone, axisFormat]);

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
    const text = emptyStateText(!!result, count, canCreate);
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
