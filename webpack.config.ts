/*
 * Extends the scaffolded webpack config (.config/ is managed by
 * @grafana/create-plugin and must not be edited), as described in
 * https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations
 *
 * The scaffold already builds nested plugins (every plugin.json under src/
 * with a sibling module.ts becomes <dir>/module.js, and every *.json is
 * copied), but it only copies the logos and screenshots that the ROOT
 * plugin.json names. The nested panel and data source name their own img/ files,
 * relative to their own plugin.json, and Grafana serves them from that
 * plugin's folder, so copy those too.
 */
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { Configuration } from 'webpack';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config.ts';

const SRC = path.resolve(process.cwd(), 'src');

function nestedPluginAssets() {
  const patterns: Array<{ from: string; to: string }> = [];
  // '*/**/' skips src/plugin.json itself: the scaffold handles the root
  for (const rel of glob.sync('*/**/plugin.json', { cwd: SRC, posix: true })) {
    const dir = path.posix.dirname(rel);
    const json = JSON.parse(fs.readFileSync(path.join(SRC, rel), 'utf8'));
    const files = new Set<string>(
      [
        json.info?.logos?.small,
        json.info?.logos?.large,
        ...(json.info?.screenshots || []).map((s: { path: string }) => s.path),
      ].filter((p): p is string => typeof p === 'string' && p !== '' && !/^https?:/.test(p))
    );
    for (const file of files) {
      const p = path.posix.join(dir, file);
      patterns.push({ from: p, to: p });
    }
  }
  return patterns;
}

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  const patterns = nestedPluginAssets();
  const cache = baseConfig.cache;
  return {
    ...baseConfig,
    // the scaffold keys its filesystem cache on its own config file only
    cache:
      cache && typeof cache === 'object' && cache.type === 'filesystem'
        ? {
            ...cache,
            buildDependencies: {
              ...cache.buildDependencies,
              config: [...(cache.buildDependencies?.config || []), path.resolve(process.cwd(), 'webpack.config.ts')],
            },
          }
        : cache,
    plugins: [...(baseConfig.plugins || []), ...(patterns.length ? [new CopyWebpackPlugin({ patterns })] : [])],
  };
};

export default config;
