export interface PanelAnnotation {
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
export function extractAnnotations(frames: any[] | undefined): PanelAnnotation[] {
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
