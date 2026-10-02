import type { SourceZone } from './source';

/* ---- the DOM side of per-source zones (#68): the header zone chip ---- */
/* the header chip for a zoned source: city, then " · offset". Text and
 * title are set by attachZoneChip/dressZoneChip with textContent, so a
 * zone name never becomes markup */
export function zoneChip(srcTZ: string | null): string {
  return srcTZ ? '<span class="st tz"><span class="tzc"></span><span class="tzo"></span></span>' : '';
}
export function attachZoneChip(z: SourceZone, host: ParentNode): void {
  z.el = host.querySelector<HTMLElement>('.tz');
  if (!z.el) {return;}
  // zoneChip's markup has .tzc and .tzo, and it renders only for a zoned
  // source, whose texts zoneFor always sets
  z.el.querySelector('.tzc')!.textContent = z.texts!.label;
  z.offEl = z.el.querySelector('.tzo');
}
/* refresh a zone chip's offset for instant ts: one memoized lookup, and the
 * DOM is touched only when the text changes (a DST change inside the
 * window, the cursor crossing it) */
export function dressZoneChip(z: SourceZone, ts: number): void {
  if (!z.el) {return;}
  // a chip (el) implies texts and offEl: see attachZoneChip
  const o = z.texts!.off(ts);
  if (o === z.off) {return;}
  z.off = o;
  z.offEl!.textContent = o ? ' · ' + o : '';
  z.el.title = 'Source time zone: ' + z.texts!.zone + (o ? ' (' + o + ' from panel time)' : ' (same as panel time)');
}
