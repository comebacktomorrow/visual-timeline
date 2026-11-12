/* The panel's options and field config, as Grafana's editor shows them. */
import { FieldConfigProperty, FieldType, type PanelOptionsSupplier, type SetFieldConfigOptionsArgs } from '@grafana/data';

import { FRAME_WIDTH, FRAME_WIDTH_MAX, FRAME_WIDTH_MIN } from '../vt/ui/frameWidth';

export interface VisualTimelineOptions {
  mode?: 'timeline' | 'grid';
  followCrosshair?: boolean;
  imageFit?: 'fit' | 'fill';
  showDetails?: boolean;
  hideEmpty?: boolean;
  showAnnotations?: boolean;
  annotationLanes?: 'shared' | 'per-source';
  headerMode?: 'bar' | 'inline' | 'inline-gradient';
  thumbTimes?: 'panel' | 'source';
  /** Frames without a promise (docs/TIMELINE-MODEL.md): how long one is
   * shown when no frame follows it soon. Auto, until the next frame, or up
   * to holdFor. ('never', 'always' and 'threshold' are the pre-M9 values.) */
  holdFrames?: 'auto' | 'next' | 'limit' | 'never' | 'always' | 'threshold';
  holdFor?: string;
  /** A promise for every host in the panel ("1m"): a frame missing past it
   * is offline. Empty: what the data says. */
  expectedCadence?: string;
  /** The preview player's default scrubber style (M10). */
  playerScrubber?: 'ticks' | 'thumbs';
  /** The least width a frame gets, px: the strip's slots and the player's ticks. */
  frameWidth?: number;
  /** A line along the strip's foot where a host has video (M10c). */
  showVideoLine?: boolean;
  /** Video starts at the speed that fits a slot's video into ~10 s (M10c). */
  videoAutoSpeed?: boolean;
  /** Header chips (#126): which, in order, and what a click does. */
  chips?: string;
  chipClick?: 'filter' | 'link' | 'none';
  chipLink?: string;
  /** Frame fields (#126): which fields of the query hold each frame's time,
   * image, host and so on. Empty: found by their usual names. */
  timeField?: string;
  imageField?: string;
  hostField?: string;
  siteField?: string;
  previewField?: string;
  /** A video clip's URL (M10c). */
  videoField?: string;
  /** State fields (#126, M4): which field holds each host's state. */
  stateField?: string;
  cadenceField?: string;
}

/* Field config for state queries (#126, M4): value mappings give each
 * state its label and colour (a mapping to Transparent is the normal state,
 * drawn as nothing), and "Pauses frames" marks a state field whose states
 * mean the host deliberately sends no frames. Set per field with
 * overrides. The other standard options don't apply to frames. */
export const fieldConfig: SetFieldConfigOptionsArgs = {
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
};

export const panelOptions: PanelOptionsSupplier<VisualTimelineOptions> = (builder) => {
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
    .addTextInput({
      path: 'chips',
      name: 'Header chips',
      category: ['Header'],
      description: 'Which chips follow each host\'s name, in order: site, location, or tag keys, comma-separated (for example: site, env). Empty: the site and location, and every tag.',
      defaultValue: '',
    })
    .addRadio({
      path: 'chipClick',
      name: 'Chip click',
      category: ['Header'],
      description: 'What clicking a host or chip does. Filter: add it to the dashboard\'s ad hoc filter, where the data source supports one. Link: open a URL. None: the chips are plain text.',
      defaultValue: 'filter',
      settings: { options: [
        { value: 'filter', label: 'Filter' },
        { value: 'link', label: 'Link' },
        { value: 'none', label: 'None' },
      ] },
    })
    .addTextInput({
      path: 'chipLink',
      name: 'Chip link',
      category: ['Header'],
      description: 'The URL a click opens. ${__chip.key}, ${__chip.value} and ${__host} are the clicked chip\'s; dashboard variables work too. For example: /d/abc?var-host=${__host}',
      defaultValue: '',
      showIf: (o) => o.chipClick === 'link',
    })
    .addTextInput({
      path: 'expectedCadence',
      name: 'Expected cadence',
      category: ['Missing frames'],
      description: 'How often every host promises a frame: 1m, 30s, 15m. A frame missing past it is drawn red, as offline. Empty: each host\'s own cadence field or declared pace, if any; a host with none promises nothing and is never red.',
      defaultValue: '',
    })
    .addRadio({
      path: 'holdFrames',
      name: 'Hold frames without a promise',
      category: ['Missing frames'],
      description: 'A frame whose source promises no cadence (no cadence field, Expected cadence or declared pace) is shown until the next one, up to this limit; past it the strip is a neutral "no data", never red. Auto: three times the typical gap around that frame.',
      defaultValue: 'auto',
      settings: { options: [
        { value: 'auto', label: 'Auto' },
        { value: 'next', label: 'Until the next frame' },
        { value: 'limit', label: 'Up to' },
      ] },
    })
    .addTextInput({
      path: 'holdFor',
      name: 'Hold for',
      category: ['Missing frames'],
      description: 'How long after a frame it is shown: 90s, 10m, 1h. Longer silences are no data.',
      defaultValue: '10m',
      showIf: (o) => o.holdFrames === 'limit' || o.holdFrames === 'threshold',
    })
    .addRadio({
      path: 'playerScrubber',
      name: 'Scrubber style',
      category: ['Preview player'],
      description: 'Clicking a frame opens a player with the slot\'s own timeline: the frames the slot holds but can\'t show. Ticks: a mark per frame at its true time (loads only the frame under the playhead). Thumbnails: the frames themselves. Viewers can change it in the player; their last choice is remembered.',
      defaultValue: 'ticks',
      settings: { options: [
        { value: 'ticks', label: 'Ticks' },
        { value: 'thumbs', label: 'Thumbnails' },
      ] },
    })
    .addBooleanSwitch({
      path: 'videoAutoSpeed',
      name: 'Speed up video to fit (experimental)',
      category: ['Preview player'],
      description: 'Video starts at the speed that plays a slot\'s video in about ten seconds (up to 16x). Off: it starts at 1x; viewers pick another speed (1/4x to 16x) in the player.',
      defaultValue: false,
    })
    .addBooleanSwitch({
      path: 'hideEmpty',
      name: 'Hide hosts with no data',
      description: 'Leave out hosts with no frames in the time range, instead of showing them offline',
      defaultValue: false,
    })
    .addSliderInput({
      path: 'frameWidth',
      name: 'Frame width',
      description: 'The least width a frame gets, in pixels, wherever it is drawn: the strip\'s slots, and the ticks in the player\'s timeline of a slot. Smaller shows more detail and loads more images; larger, fewer.',
      defaultValue: FRAME_WIDTH,
      settings: { min: FRAME_WIDTH_MIN, max: FRAME_WIDTH_MAX, step: 1 },
    })
    .addBooleanSwitch({
      path: 'showVideoLine',
      name: 'Mark video on the strip (experimental)',
      description: 'A thin line along the foot of each strip where its host has video clips. Off: only the preview shows them.',
      defaultValue: false,
      showIf: (o) => o.mode !== 'grid',
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
      path: 'videoField',
      name: 'Video (experimental)',
      category: ['Frame fields'],
      description: 'Optional: a video clip that starts at the row\'s time; the click-in preview plays it over the frames. Empty: a field named video. Its end: a video_end field, else a video_duration (ms), else as long as the host\'s clips that say, else a frame\'s time.',
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
};
