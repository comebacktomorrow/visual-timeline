import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/* The panel's code names none of our own conventions (#126, "minimise the
 * panel's assumptions"). The reference worker's pause reasons, its image URL
 * layout and its variant names belong at the edges: the API and demo
 * backends (src/vt/backends), our data source and what it shares with the
 * panel about its own answers (src/datasource, src/shared/sources.ts). The
 * core and the panel draw what the data says, through labels, colours and
 * field roles. */
const ROOT = join(__dirname);
const EDGES = ['vt/backends', 'datasource', 'shared/sources.ts', 'shared/lastFrame.ts'];
const WORDS = ['screen-sleep', 'system-down', 'app-stopped', 'QUIET HOURS', '/frame/lo', '/frame/hi', 'hiCadence', 'r-quiet'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {return name === '__snapshots__' ? [] : files(p);}
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

test('the core and the panel name none of the reference worker\'s conventions', () => {
  const hits: string[] = [];
  for (const f of files(ROOT)) {
    const rel = relative(ROOT, f);
    if (EDGES.some((e) => rel === e || rel.startsWith(e + '/'))) {continue;}
    const text = readFileSync(f, 'utf8');
    for (const w of WORDS) {if (text.includes(w)) {hits.push(`${rel}: ${w}`);}}
  }
  expect(hits).toEqual([]);
});

/* The README is the catalog page. Grafana's plugin validator fails a
 * submission whose README has a relative link (it can't resolve one on
 * grafana.com), so every link and image is absolute or an in-page anchor. */
test('the README links only absolutely', () => {
  const readme = readFileSync(join(ROOT, '..', 'README.md'), 'utf8');
  const relativeLinks = [
    ...[...readme.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ].filter((u) => !/^(https?:|#|mailto:)/.test(u));
  expect(relativeLinks).toEqual([]);
});
