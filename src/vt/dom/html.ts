import type { SourceDecl } from '../types';

/* Source ids, sites, locations and tags come from the registry API, so they
 * are untrusted. Everything spliced into an innerHTML template goes through
 * esc() — text AND attribute context (quotes are escaped too). */
export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
}
/* Marks a header element as a filter: a host that passes cfg.onFilter gets
 * (key, value) when it is clicked or activated from the keyboard (see
 * wireFilters). Keys are the ad hoc filter keys the Grafana data source
 * offers: host, site, or a tag key. `filterable` (the mount has onFilter)
 * also makes it a focusable button that says what it does. */
export function filterAttrs(key: string, value: string, filterable = false): string {
  const a = ' data-fk="' + esc(key) + '" data-fv="' + esc(value) + '"';
  return filterable ? a + ' role="button" tabindex="0" title="' + esc('Filter by ' + key + ' = ' + value) + '"' : a;
}
/* Tags read key=value, the form the Tags query field and the ad hoc filter
 * bar use. */
export function tagChips(decl: Pick<SourceDecl, 'tags'>, filterable = false): string {
  if (!decl.tags) {return '';}
  const chips = Object.entries(decl.tags)
    .map(([k, v]) => '<span class="st"' + filterAttrs(k, v, filterable) + '>' + esc(k) + '=' + esc(v) + '</span>')
    .join('');
  return '<span class="tags">' + chips + '</span>';
}
/* Plain text: escape at the splice point, esc(headTitle(decl)). */
export function headTitle(decl: Pick<SourceDecl, 'site' | 'location' | 'tags'>): string {
  const parts = [decl.site];
  if (decl.location) {parts.push(decl.location);}
  if (decl.tags) {for (const [k, v] of Object.entries(decl.tags)) {parts.push(k + '=' + v);}}
  return parts.join(' · ');
}

/* Header clicks as filters: with cfg.onFilter, a click on any [data-fk]
 * element (the host name, the site chip, a tag chip) calls it with that key
 * and value, and the chips show they are clickable. Without it, nothing. */
export function wireFilters(wrap: HTMLElement, onFilter?: (key: string, value: string) => void): void {
  if (!onFilter) {return;}
  wrap.classList.add('filterable');
  const filter = (e: Event) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-fk]');
    if (!el || !wrap.contains(el)) {return;}
    e.preventDefault();
    e.stopPropagation();
    onFilter(el.dataset.fk || '', el.dataset.fv || '');
  };
  // capture: a tile opens its preview on click, and it must not see this one
  wrap.addEventListener('click', filter, true);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {filter(e);}
  });
}
