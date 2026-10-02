/* a Grafana variable value (site/source) → the ids it selects, or null for
 * all of them */
export function parseVar(v: string | null | undefined): string[] | null {
  if (!v || v === 'All' || v === '$__all') {return null;}
  return v.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

/* panel-side tag filtering: "env=prod, room=lobby" must ALL match */
/* lowercased key → lowercased value, every one required */
export type TagFilter = Record<string, string>;
export function parseTagFilter(expr: string | null | undefined): TagFilter | null {
  if (!expr) {return null;}
  const out: TagFilter = {};
  for (const part of String(expr).split(',')) {
    const i = part.indexOf('=');
    const key = i >= 0 ? part.slice(0, i).trim().toLowerCase() : '';
    // blank keys are dropped AFTER trimming: " =x" (as typed after ", ") too
    if (key) {out[key] = part.slice(i + 1).trim().toLowerCase();}
  }
  return Object.keys(out).length ? out : null;
}
export function matchesTags(tags: Record<string, unknown> | null | undefined, filter: TagFilter | null): boolean {
  if (!filter) {return true;}
  // no tags object reads like an empty one: a missing tag is '' either way
  const t = tags || {};
  for (const k in filter) {
    if (String(t[k] == null ? '' : t[k]).toLowerCase() !== filter[k]) {return false;}
  }
  return true;
}
