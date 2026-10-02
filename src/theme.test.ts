import { colorManipulator, createTheme } from '@grafana/data';
import { KTL_VAR_DEFAULTS } from './core';
import { themeVars } from './theme';

const dark = createTheme({ colors: { mode: 'dark' } });
const light = createTheme({ colors: { mode: 'light' } });
const known = Object.keys(KTL_VAR_DEFAULTS);

describe('themeVars', () => {
  test.each([
    ['dark', dark],
    ['light', light],
  ])('%s: only sets palette vars the core declares, all with values', (_, theme) => {
    const vars = themeVars(theme);
    for (const [k, v] of Object.entries(vars)) {
      expect(known).toContain(k);
      expect(v).toMatch(/\S/);
      expect(v).not.toMatch(/undefined|NaN/);
    }
  });

  test('dark keeps the colours the panel has always used', () => {
    const vars = themeVars(dark);
    const same = (k: keyof typeof KTL_VAR_DEFAULTS) => expect(vars[k].toLowerCase()).toBe(KTL_VAR_DEFAULTS[k].toLowerCase());
    same('--ktl-bg');
    same('--ktl-accent');
    same('--ktl-live');
    same('--ktl-off');
    same('--ktl-link');
    same('--ktl-ann');
  });

  test('dark leaves the hand-tuned hatches and bands to the defaults', () => {
    const vars = themeVars(dark);
    for (const k of ['--ktl-gap-a', '--ktl-pause-a', '--ktl-sleep-a', '--ktl-unint', '--ktl-pending', '--ktl-scrim']) {
      expect(vars).not.toHaveProperty(k);
    }
  });

  test('light overrides every palette var, so no dark default leaks through', () => {
    expect(Object.keys(themeVars(light)).sort()).toEqual([...known].sort());
  });

  test('light follows the theme surfaces and text', () => {
    const vars = themeVars(light);
    expect(vars['--ktl-bg']).toBe(light.colors.background.primary);
    expect(vars['--ktl-bg2']).toBe(light.colors.background.secondary);
    expect(vars['--ktl-border']).toBe(light.colors.border.weak);
    expect(vars['--ktl-text']).toBe(light.colors.text.primary);
    expect(vars['--ktl-dim']).toBe(light.colors.text.secondary);
  });

  test('light text colours stay readable on the light surfaces', () => {
    const vars = themeVars(light);
    const canvas = light.colors.background.canvas;
    const ratio = (fg: string, bg: string) => colorManipulator.getContrastRatio(fg, bg, canvas);
    expect(ratio(vars['--ktl-text'], vars['--ktl-bg2'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(vars['--ktl-dim'], vars['--ktl-bg2'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(vars['--ktl-off'], vars['--ktl-bg'])).toBeGreaterThanOrEqual(4.5);
    // pause-band labels and tile captions sit on the media background
    for (const k of ['--ktl-sleep', '--ktl-down', '--ktl-stopped', '--ktl-unint']) {
      expect(ratio(vars[k], vars['--ktl-media'])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
