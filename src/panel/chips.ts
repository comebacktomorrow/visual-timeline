/* Header chips (#126): which ones the panel shows, and what a click does. */

/** The chip list option ("site, env") as the core wants it; empty means the
 * default chips (undefined). */
export function parseChips(v: string | undefined): string[] | undefined {
  const list = (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/** A chip's link: ${__chip.key}, ${__chip.value} and ${__host} replaced by
 * the clicked chip's, URL-encoded, before Grafana replaces the dashboard's
 * own variables. */
export function chipLinkUrl(template: string, key: string, value: string, host: string | undefined): string {
  return template
    .replace(/\$\{__chip\.key\}/g, encodeURIComponent(key))
    .replace(/\$\{__chip\.value\}/g, encodeURIComponent(value))
    .replace(/\$\{__host\}/g, encodeURIComponent(host ?? ''));
}
