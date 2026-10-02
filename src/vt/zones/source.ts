import { fmtShort, fmtTime, isZone, type TimeZoneName, zoneOf, zoneWarned } from '../time/zones';
import type { SourceDecl } from '../types';

/* ---- per-source zones (#68) ----
 * A source may declare where it is (`timezone` in /sources, from the
 * uploader's X-Timezone header). The panel's zone still runs the axis, the
 * crosshair and the annotation tooltips; a source's zone only labels its
 * header and, with cfg.thumbTimes === 'source', its own time text. */

/* the declared zone of a source, or null: absent, blank and unknown names
 * all mean "none" (never the browser's zone — that would label a source
 * with the viewer's location). The declared spelling is kept: Intl's
 * canonical ids are the old names (Asia/Calcutta for Asia/Kolkata). */
export function sourceTimeZone(decl: Pick<SourceDecl, 'timezone'> | null | undefined): string | null {
  const raw = decl && decl.timezone;
  if (typeof raw !== 'string') {return null;}
  const s = raw.trim();
  if (!s || /^(browser|default|local)$/i.test(s)) {return null;}
  if (/^(?:etc\/)?utc$/i.test(s)) {return 'UTC';}
  if (isZone(s)) {return s;}
  if (!zoneWarned.has(s)) {
    zoneWarned.add(s);
    console.warn('[visual-timeline] source declares unknown time zone "' + s + '"; ignoring it');
  }
  return null;
}
/* a short name for a zone: its city (the IANA name's last segment) */
export function zoneLabel(tz: TimeZoneName): string {
  const s = String(tz || '');
  if (/^(?:etc\/)?utc$/i.test(s)) {return 'UTC';}
  return s.slice(s.lastIndexOf('/') + 1).replace(/_/g, ' ');
}
/* a zone difference as text: +3h, +5h45m, −30m (a real minus); '' for none */
export function fmtOffset(ms: number): string {
  const m = Math.round(ms / 60e3);
  if (!m) {return '';}
  const a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
  return (m < 0 ? '−' : '+') + (h ? h + 'h' : '') + (mm ? mm + 'm' : '');
}
/* how far `tz` is ahead of `refTz` at instant ts, as fmtOffset text. Depends
 * on the instant: either zone may be on daylight time. */
export function zoneOffsetText(tz: TimeZoneName, refTz: TimeZoneName, ts: number): string {
  return fmtOffset(zoneOf(tz).offset(ts) - zoneOf(refTz).offset(ts));
}
/* the header label: "Sydney · +3h", or just "Sydney" when the source's
 * clock currently reads the same as the panel's */
export function zoneHeadText(tz: TimeZoneName, refTz: TimeZoneName, ts: number): string {
  const off = zoneOffsetText(tz, refTz, ts);
  return zoneLabel(tz) + (off ? ' · ' + off : '');
}
/* Time text for one source: in `zone`, and with `suffix` each value carries
 * its offset from the panel zone (07:31:00 (+3h)) so it can't pass for
 * panel time. The offset is memoized per minute (zones change offset on
 * whole minutes), so a scrub costs at most one recompute per minute moved. */
export interface ZoneTexts {
  zone: string;
  label: string;
  off: (ts: number) => string;     // offset from the panel zone, fmtOffset text
  time: (ts: number) => string;    // HH:mm:ss
  short: (ts: number) => string;   // HH:mm
  sfx: (ts: number) => string;     // ' (+3h)' with suffix, else ''
}
export function zoneTexts(zone: string, panelTZ: string, suffix: boolean): ZoneTexts {
  let memoMin = NaN, memo = '';
  const off = (ts: number) => {
    const m = Math.floor(ts / 60e3);
    if (m !== memoMin) { memoMin = m; memo = zone === panelTZ ? '' : zoneOffsetText(zone, panelTZ, ts); }
    return memo;
  };
  const label = zoneLabel(zone);
  return {
    zone, label, off,
    time: (ts) => fmtTime(ts, zone),
    short: (ts) => fmtShort(ts, zone),
    sfx: suffix ? (ts) => { const o = off(ts); return o ? ' (' + o + ')' : ''; } : () => '',
  };
}
/* one source's zone state in a mount: srcTZ (null when undeclared), its
 * texts (header chip), and tt, the time text its captions use: its own
 * zone's with thumbTimes 'source', else the panel's (panelTT) */
export interface SourceZone {
  srcTZ: string | null;
  texts: ZoneTexts | null;
  tt: ZoneTexts;
  // the header chip, filled in by the DOM layer (attachZoneChip, dressZoneChip)
  el: HTMLElement | null;
  offEl: Element | null;
  off: string | null;
}
export function zoneFor(
  decl: Pick<SourceDecl, 'timezone'> | null | undefined, panelTZ: string, thumbTimes: string | undefined, panelTT: ZoneTexts
): SourceZone {
  const srcTZ = sourceTimeZone(decl);
  const texts = srcTZ ? zoneTexts(srcTZ, panelTZ, true) : null;
  return { srcTZ, texts, tt: texts && thumbTimes === 'source' ? texts : panelTT, el: null, offEl: null, off: null };
}
