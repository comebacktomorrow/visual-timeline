// Fails on any high or critical npm advisory that osv-scanner.toml hasn't
// accepted. The Grafana plugin validator reads the same file, so one list
// covers both gates.
//
//   node audit-gate.mjs <path to osv-scanner.toml>   (run where package-lock.json is)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tomlPath = process.argv[2];
const accepted = new Map(); // advisory id -> ignoreUntil (Date or null)
for (const block of readFileSync(tomlPath, 'utf8').split('[[IgnoredVulns]]').slice(1)) {
  const id = block.match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1];
  const until = block.match(/^\s*ignoreUntil\s*=\s*(\S+)/m)?.[1];
  if (id) {accepted.set(id, until ? new Date(until) : null);}
}

let report;
try {
  report = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8' });
} catch (e) {
  report = e.stdout; // npm audit exits non-zero whenever it finds anything
}
const vulns = JSON.parse(report).vulnerabilities || {};

const now = new Date();
const failing = [];
for (const [pkg, v] of Object.entries(vulns)) {
  // `via` entries that are objects are the advisories themselves; string
  // entries only say "through that package", which is reported on its own.
  for (const adv of v.via.filter((x) => typeof x === 'object')) {
    if (adv.severity !== 'high' && adv.severity !== 'critical') {continue;}
    const id = (adv.url || '').split('/').pop();
    const until = accepted.get(id);
    if (accepted.has(id) && (until === null || until > now)) {
      console.log(`accepted until ${until ? until.toISOString().slice(0, 10) : 'further notice'}: ${pkg} ${id} (${adv.title})`);
      continue;
    }
    failing.push(`${adv.severity}: ${pkg} ${id} (${adv.title})${accepted.has(id) ? ' — acceptance expired' : ''}`);
  }
}

if (failing.length) {
  console.error(failing.join('\n'));
  console.error(`\n${failing.length} high/critical advisor${failing.length === 1 ? 'y' : 'ies'} not accepted in ${tomlPath}.`);
  process.exit(1);
}
console.log('No unaccepted high or critical advisories.');
