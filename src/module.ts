import React, { useEffect, useRef } from 'react';
import { PanelPlugin, PanelProps, DataHoverEvent, DataHoverClearEvent } from '@grafana/data';
import { mountTimeline, mountGrid } from './core';

interface VisualTimelineOptions {
  apiUrl?: string;
  sites?: string;
  mode?: 'timeline' | 'grid';
  followCrosshair?: boolean;
  imageFit?: 'fit' | 'fill';
  showDetails?: boolean;
  hideEmpty?: boolean;
  tagFilter?: string;
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
  const showDetails = options.showDetails === true;
  const hideEmpty = options.hideEmpty === true;
  const tagFilter = (options.tagFilter || '').trim();

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const common = { site, from, to, width: props.width, fit, apiUrl, showDetails, hideEmpty, tagFilter };
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
  }, [mode, fit, apiUrl, showDetails, hideEmpty, tagFilter, site, from, to, props.width, props.height]);

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

export const plugin = new PanelPlugin<VisualTimelineOptions>(TimelinePanel).setPanelOptions((builder) => {
  builder
    .addTextInput({
      path: 'apiUrl',
      name: 'API URL',
      description: 'Frames API base URL (see docs/API.md in the repository). Empty = built-in demo data.',
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
