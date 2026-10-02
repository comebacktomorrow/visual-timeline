import { getTimeZone } from '@grafana/data';

/* The dashboard's time zone, in the core's terms (cfg.timeZone).
 *
 * Grafana hands a panel 'browser', 'utc', an IANA name, or '' for "the
 * default", meaning the user's, team's or org's preference. getTimeZone
 * resolves '' to that preference, which can itself be 'browser' or ''.
 * The core takes 'utc' and IANA names, and reads undefined as the browser's
 * own zone. A name the core cannot resolve also falls back to the browser's,
 * as Grafana's own date formatting does.
 *
 * getTimeZone has been in @grafana/data since Grafana 7, and the panel's
 * `timeZone` prop longer still, so this works on every Grafana the plugin
 * supports (>= 10.4). */
export function coreTimeZone(tz: string | undefined): string | undefined {
  const z = getTimeZone({ timeZone: tz && tz !== 'default' ? tz : undefined });
  return !z || z === 'browser' || z === 'default' ? undefined : z;
}
