import React, { useEffect, useRef } from 'react';
import { PanelPlugin, PanelProps, DataHoverEvent, DataHoverClearEvent } from '@grafana/data';
import { mountTimeline, mountGrid } from './core';

interface VisualTimelineOptions {
  apiUrl?: string;
  apiKey?: string;
  sites?: string;
  mode?: 'timeline' | 'grid';
  followCrosshair?: boolean;
  imageFit?: 'fit' | 'fill';
  showDetails?: boolean;
  hideEmpty?: boolean;
  tagFilter?: string;
  showAnnotations?: boolean;
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
    if (!time) continue;
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

  const from = props.timeRange.from.valueOf();
  const to = props.timeRange.to.valueOf();
  const options = props.options || {};
  /* The site expression lives in a panel OPTION (persisted in panel JSON)
   * so Grafana's variable-dependency scan sees it and refreshes this panel
   * on variable change — resolving it only via replaceVariables() would be
   * invisible to the scanner and the panel would go stale until refresh. */
  const siteExpr = options.sites || '${site:csv}';
  const site = props.replaceVariables ? props.replaceVariables(siteExpr) : '';
  const mode = options.mode || 'timeline';
  const follow = options.followCrosshair !== false;
  const fit = options.imageFit || 'fit';
  const apiUrl = (options.apiUrl || '').trim();
  const apiKey = (options.apiKey || '').trim();
  const showDetails = options.showDetails === true;
  const hideEmpty = options.hideEmpty === true;
  const tagFilter = (options.tagFilter || '').trim();
  const showAnnotations = options.showAnnotations !== false;
  const annotations = showAnnotations ? extractAnnotations(props.data?.annotations as any[]) : [];
  // remount only when annotation CONTENT changes, not on every data-object identity flip
  const annKey = JSON.stringify(annotations);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const common = {
      site, from, to, width: props.width, fit, apiUrl, apiKey, showDetails, hideEmpty, tagFilter,
      annotations, showAnnotations,
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
  }, [mode, fit, apiUrl, apiKey, showDetails, hideEmpty, tagFilter, site, from, to, props.width, props.height, annKey]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.eventBus, mode, follow]);

  return React.createElement('div', {
    ref,
    style: { width: '100%', height: '100%', overflow: 'hidden' },
  });
};

export const plugin = new PanelPlugin<VisualTimelineOptions>(TimelinePanel)
  // without this Grafana strips annotations out of PanelData before the
  // panel sees them — declaring support is what turns the stream on
  .setDataSupport({ annotations: true })
  .setPanelOptions((builder) => {
  builder
    .addTextInput({
      path: 'apiUrl',
      name: 'API URL',
      description: 'Frames API base URL (see docs/API.md in the repository). Empty = built-in demo data.',
      defaultValue: '',
    })
    .addTextInput({
      path: 'apiKey',
      name: 'API key',
      description: 'Viewer token for the frames API, if it requires one. Sent as a Bearer header on API calls and as ?k= on image URLs.',
      defaultValue: '',
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
