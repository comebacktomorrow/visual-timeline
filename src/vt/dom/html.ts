import type { SourceDecl } from '../types';

/* Source ids, sites, locations and tags come from the registry API, so they
 * are untrusted. Everything spliced into an innerHTML template goes through
 * esc() — text AND attribute context (quotes are escaped too). */
export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
}
export function tagChips(decl: Pick<SourceDecl, 'tags'>): string {
  if (!decl.tags) {return '';}
  const chips = Object.entries(decl.tags)
    .map(([k, v]) => '<span class="st">' + esc(k) + ':' + esc(v) + '</span>')
    .join('');
  return '<span class="tags">' + chips + '</span>';
}
/* Plain text: escape at the splice point, esc(headTitle(decl)). */
export function headTitle(decl: Pick<SourceDecl, 'site' | 'location' | 'tags'>): string {
  const parts = [decl.site];
  if (decl.location) {parts.push(decl.location);}
  if (decl.tags) {for (const [k, v] of Object.entries(decl.tags)) {parts.push(k + ':' + v);}}
  return parts.join(' · ');
}
