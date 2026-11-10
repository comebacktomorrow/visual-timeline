import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FieldConfigProperty,
  dateTimeFormat,
  DataHoverClearEvent,
  DataHoverEvent,
  FieldType,
  LoadingState,
  PanelPlugin,
  PanelProps,
  systemDateFormats,
} from '@grafana/data';
import { config, getDataSourceSrv } from '@grafana/runtime';
import { usePanelContext, useTheme2 } from '@grafana/ui';
import { mountTimeline, mountGrid } from '../core';
import type { AxisFormatter } from '../vt/time/ticks';
import { themeVars } from '../theme';
import { coreTimeZone } from '../timezone';
import { DATASOURCE_ID } from '../shared/ids';
import { sourcesFromFrames } from '../shared/sources';
import { FieldRoles, recordsBackend, recordsFromSeries } from '../shared/frameRecords';
import { stateAnnotations, statesFromSeries } from '../shared/hostState';
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
  /** Frame fields (#126): which fields of the query hold each frame's time,
   * image, host and so on. Empty: found by their usual names. */
  timeField?: string;
  imageField?: string;
  hostField?: string;
  siteField?: string;
  previewField?: string;
  /** State fields (#126, M4): which field holds each host's state. */
  stateField?: string;
  cadenceField?: string;
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
/* What a panel that can't draw says instead. Errors from the data source
 * aren't repeated here: Grafana shows them in the panel's error indicator. */
function emptyStateText(hasSources: boolean, dataSourceCount: number, canCreate: boolean, hasData = false) {
  if (hasData && !hasSources) {
    return { lines: ["No frames in this panel's query.", 'It needs a time, an image URL and a host per row. Set Frame fields in the panel options if they have other names.'] };
  }
  if (hasSources) {
    return { lines: ['No hosts match.', "Check this panel's query (Sites, Hosts, Tags) and the dashboard's filters."] };
  }
  const needs = 'It draws rows with a time, an image and a host, from any data source.';
  if (dataSourceCount > 0) {
    return { lines: ["This panel's query returned nothing.", needs, 'A Visual Timeline data source with Demo data on has some to try.'] };
  }
  return canCreate
    ? {
        lines: ["This panel's query returned nothing.", needs],
        link: { text: 'Add a Visual Timeline data source', after: ' and turn on its Demo data to try the panel.' },
      }
    : { lines: ["This panel's query returned nothing.", needs, 'A Grafana admin can add a Visual Timeline data source with Demo data to try it.'] };
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
  /* Frame records: rows with a time, an image and a host, from any data
   * source (#126). When the query returns any, they are what the panel
   * draws; a Visual Timeline source list in the same result adds what it
   * knows about each host (history, time zone, tags). */
  const roles: FieldRoles = {
    time: options.timeField, image: options.imageField, host: options.hostField,
    site: options.siteField, preview: options.previewField, cadence: options.cadenceField,
  };
  const records = recordsFromSeries(props.data?.series, roles);
  // keyed on content, as above: a host's frames only ever grow, so its count
  // and newest frame say whether anything changed
  const recordsKey = records
    ? JSON.stringify(records.map((h) => [h.site, h.id, h.cadence, h.frames.length, h.frames[0]?.ts, h.frames.at(-1)?.ts, h.frames.at(-1)?.url]))
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recordsMemo = useMemo(() => records, [recordsKey]);
  // a source list without records (no frames in the window) still draws its
  // hosts: a host that was silent the whole time is information
  const backend = useMemo(
    () => (recordsMemo || result || statesMemo ? recordsBackend(recordsMemo ?? [], result?.sources, statesMemo ?? []) : null),
    [recordsMemo, result, statesMemo]
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
  const showFrames = !!backend && (recordsMemo ? recordsMemo.length > 0 : result!.sources.length > 0);

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
    const hasData = (props.data?.series || []).some((f) => f.length > 0);
    const text = emptyStateText(!!result || !!recordsMemo, count, canCreate, hasData);
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
  /* Field config for state queries (#126, M4): value mappings give each
   * state its label and colour (a mapping to Transparent is the normal state,
   * drawn as nothing), and "Pauses frames" marks a state field whose states
   * mean the host deliberately sends no frames. Set per field with
   * overrides. The other standard options don't apply to frames. */
  .useFieldConfig({
    disableStandardOptions: [
      FieldConfigProperty.Unit, FieldConfigProperty.Min, FieldConfigProperty.Max, FieldConfigProperty.Decimals,
      FieldConfigProperty.DisplayName, FieldConfigProperty.NoValue, FieldConfigProperty.Thresholds,
      FieldConfigProperty.Color, FieldConfigProperty.Links, FieldConfigProperty.FieldMinMax,
    ],
    useCustomConfig: (builder) => {
      builder.addBooleanSwitch({
        path: 'pausesFrames',
        name: 'Pauses frames',
        description: 'For a state field: while a state lasts the host deliberately sends no frames, so missing frames are explained by the state instead of drawn as offline. Off: the state runs alongside the frames.',
        defaultValue: false,
      });
    },
  })
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
        'Draw the dashboard\'s annotations (from any data source) on the timeline. Tag one host:<id> to pin it to that host\'s strip; the rest go on a shared lane.',
      defaultValue: true,
      showIf: (o) => o.mode !== 'grid',
    })
    .addRadio({
      path: 'annotationLanes',
      name: 'Annotation lanes',
      description:
        'Shared: untagged annotations go on one lane above the axis. Per host: each host gets its own lane under its strip, with its own events and the shared ones.',
      defaultValue: 'shared',
      settings: {
        options: [
          { value: 'shared', label: 'Shared lane' },
          { value: 'per-source', label: 'Per host' },
        ],
      },
      showIf: (o) => o.mode !== 'grid' && o.showAnnotations !== false,
    })
    .addBooleanSwitch({
      path: 'hideEmpty',
      name: 'Hide hosts with no data',
      description: 'Leave out hosts with no frames in the time range, instead of showing them offline',
      defaultValue: false,
    })
    .addBooleanSwitch({
      path: 'showDetails',
      name: 'Show cadence details',
      description: 'Each host\'s capture cadence and display resolution, for tuning',
      defaultValue: false,
    })
    .addRadio({
      path: 'headerMode',
      name: 'Header',
      description:
        'Bar: a header row above each host. Inline: the header floats over the image, saving space; Gradient adds a fade behind it for busy frames.',
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
        'The clock for each host\'s thumbnail times, captions and last-seen messages. Host local time uses the zone the host declares and shows its offset, e.g. 07:31:00 (+3h); hosts without one use dashboard time. The axis and crosshair always use dashboard time.',
      defaultValue: 'panel',
      settings: {
        options: [
          { value: 'panel', label: 'Dashboard time' },
          { value: 'source', label: 'Host local time' },
        ],
      },
    })
    // Frame fields (#126): which fields of the query hold each frame's parts.
    // Empty finds them by their usual names; the pickers list the query's fields.
    .addFieldNamePicker({
      path: 'imageField',
      name: 'Image',
      category: ['Frame fields'],
      description: 'The image URL (or Base64 image data) for each frame. Empty: a field named image or url.',
      settings: { filter: (f) => f.type === FieldType.string },
    })
    .addFieldNamePicker({
      path: 'timeField',
      name: 'Time',
      category: ['Frame fields'],
      description: 'When each frame was taken. Empty: the first time field, or one named time or timestamp.',
    })
    .addFieldNamePicker({
      path: 'hostField',
      name: 'Host',
      category: ['Frame fields'],
      description: 'Which host each frame is from: one strip or tile per host. Empty: a field named host, a host label, or the query name.',
    })
    .addFieldNamePicker({
      path: 'stateField',
      name: 'State',
      category: ['Frame fields'],
      description: 'Optional: a query of host states (a time, a host and this field, no image). Empty: a field named state or status. Value mappings set each state\'s label and colour; map the normal state to Transparent.',
    })
    .addFieldNamePicker({
      path: 'siteField',
      name: 'Site',
      category: ['Frame fields'],
      description: 'Optional: groups hosts. Empty: a field named site, or a site label.',
    })
    .addFieldNamePicker({
      path: 'previewField',
      name: 'Preview image',
      category: ['Frame fields'],
      description: 'Optional: a larger image for the click-in preview. Empty: a field named image_hi or preview; without one, the image itself.',
      settings: { filter: (f) => f.type === FieldType.string },
    })
    .addFieldNamePicker({
      path: 'cadenceField',
      name: 'Cadence',
      category: ['Frame fields'],
      description: 'Optional: how often each host takes a frame, in milliseconds. Empty: a field named cadence, else the typical gap between frames.',
      settings: { filter: (f) => f.type === FieldType.number },
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
