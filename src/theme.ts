import { colorManipulator, GrafanaTheme2 } from '@grafana/data';

/* Grafana theme → the core's --ktl-* custom properties (defaults and the
 * full list: KTL_VAR_DEFAULTS in core.ts). The panel sets the result inline
 * on its mount root; the core copies the resolved values onto the tooltip
 * and click-in preview it appends to <body>.
 *
 * Chrome (surfaces, text, borders, status) follows the theme in both
 * modes. Status hues come from the visualization palette because its dark
 * values are exactly the colours the panel has always used (green, red,
 * yellow, blue), so a dark dashboard looks as before. The hatches, bands
 * and other tones derived from those are tuned by hand for dark in the
 * core's defaults; a light theme gets them derived from its own tokens
 * here, as alphas over the light surfaces. */
export function themeVars(theme: GrafanaTheme2): Record<string, string> {
  const c = theme.colors;
  const viz = (name: string) => theme.visualization.getColorByName(name);
  const a = colorManipulator.alpha;
  const accent = viz('semi-dark-yellow');
  const off = viz(theme.isDark ? 'red' : 'semi-dark-red');
  const ann = viz('blue');

  const vars: Record<string, string> = {
    '--ktl-bg': c.background.primary,
    '--ktl-bg2': c.background.secondary,
    '--ktl-border': c.border.weak,
    '--ktl-text': c.text.primary,
    '--ktl-dim': c.text.secondary,
    '--ktl-muted': c.text.secondary,
    '--ktl-strong': c.text.maxContrast,
    '--ktl-chip-text': c.text.primary,
    '--ktl-link': c.text.link,
    '--ktl-accent': accent,
    '--ktl-sel': a(accent, 0.14),
    '--ktl-live': viz('green'),
    '--ktl-off': off,
    '--ktl-media': c.background.canvas,
    '--ktl-float-bg': theme.isDark ? c.background.canvas : c.background.primary,
    '--ktl-divider': c.border.weak,
    '--ktl-ann': ann,
    '--ktl-ann-edge': c.background.canvas,
    '--ktl-ann-region': a(ann, 0.12),
    '--ktl-ann-region-edge': a(ann, 0.55),
  };
  if (theme.isDark) {
    return vars;
  }

  const text = c.text.primary;
  const band = (hue: string, fg: string, prefix: string) => ({
    [`--ktl-${prefix}-a`]: a(hue, 0.14),
    [`--ktl-${prefix}-b`]: a(hue, 0.3),
    [`--ktl-${prefix}`]: fg,
  });
  return {
    ...vars,
    '--ktl-axis-grid': c.border.medium,
    '--ktl-mag-bg': c.background.canvas,
    '--ktl-shadow': theme.shadows.z3,
    '--ktl-pending': a(text, 0.3),
    // the inline header's fade: the chips are light here, so fade to the surface
    '--ktl-scrim': a(c.background.primary, 0.75),
    '--ktl-gap-a': a(off, 0.07),
    '--ktl-gap-b': a(off, 0.2),
    '--ktl-pause-a': a(text, 0.04),
    '--ktl-pause-b': a(text, 0.13),
    '--ktl-tpause-a': a(text, 0.03),
    '--ktl-tpause-b': a(text, 0.09),
    ...band(viz('blue'), viz('dark-blue'), 'sleep'),
    ...band(viz('purple'), viz('dark-purple'), 'down'),
    // the palette has no teal; keep app-stopped's hue from the dark default
    ...band('#2ba08c', colorManipulator.darken('#6fc4b4', 0.45), 'stopped'),
    ...band(viz('orange'), c.warning.text, 'unint'),
  };
}
