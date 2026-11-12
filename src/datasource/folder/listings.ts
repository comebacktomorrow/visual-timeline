/* Directory listings (#125), as a web server or a public bucket answers
 * them, reduced to one shape: the names of the folder's subfolders and
 * files. Pure parsing; fetching is the data source's.
 *
 * - JSON: nginx `autoindex_format json` ([{name, type: "file" | "directory"}])
 *   and Caddy's browse JSON ([{name, is_dir}]);
 * - HTML: any page that lists a folder as links (Apache mod_autoindex, nginx's
 *   default autoindex, lighttpd, Python's http.server, IIS): the hrefs that
 *   point into the same folder;
 * - S3: ListObjectsV2's XML (a public S3, R2, MinIO, B2 or Wasabi bucket),
 *   listed with delimiter "/", so prefixes are folders and keys are files. */

export interface Listing {
  /** subfolder names, without a trailing slash */
  dirs: string[];
  /** file names in this folder */
  files: string[];
  /** S3: the token for the next page, when the listing is truncated */
  next?: string;
}

export type ListingFormat = 'json' | 'html' | 's3';

/** Whether a decoded name is one entry of this folder: not empty, not "." or
 * "..", and with no "/" or "\\" in it. Anything else would step out of the
 * folder (or above the base) when joined into a path (L1). */
export function isPlainName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[/\\]/.test(name);
}

/** nginx's or Caddy's JSON listing. */
export function parseJsonListing(text: string): Listing {
  const out: Listing = { dirs: [], files: [] };
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { throw new Error('The folder answered, but not with a JSON listing'); }
  if (!Array.isArray(rows)) {throw new Error('The folder answered, but not with a JSON listing (expected a list of entries)');}
  for (const r of rows as Array<Record<string, unknown>>) {
    let name = typeof r?.name === 'string' ? r.name : '';
    const dir = r?.type === 'directory' || r?.is_dir === true || name.endsWith('/');
    name = name.replace(/\/+$/, '');
    if (!isPlainName(name)) {continue;}
    (dir ? out.dirs : out.files).push(name);
  }
  return out;
}

/* entity decoding for the few that appear in hrefs and S3 keys, in one pass:
 * decoding &amp; first would turn "&amp;lt;" into "<", not "&lt;" */
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const unescapeHtml = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (e) => ENTITIES[e]);

/** A folder's HTML listing: its links into the same folder. Sort links
 * ("?C=N;O=D"), the parent ("../"), absolute links and other sites' are
 * left out; a link ending in "/" is a folder. */
export function parseHtmlListing(text: string): Listing {
  const out: Listing = { dirs: [], files: [] };
  const seen = new Set<string>();
  for (const m of text.matchAll(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    let href = unescapeHtml(m[1] ?? m[2] ?? m[3] ?? '').trim();
    // other sites, absolute paths, sort and fragment links, the parent and
    // the folder itself; "./name" is in this folder and stays
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/|\?|#|\.\.(?:\/|$)|\.\/?$)/i.test(href)) {continue;}
    href = href.replace(/^\.\//, '').replace(/[?#].*$/, '');
    const dir = href.endsWith('/');
    let name = href.replace(/\/+$/, '');
    if (!name || name.includes('/')) {continue;}   // not in this folder
    try { name = decodeURIComponent(name); } catch { /* a stray %: keep it as it is */ }
    // checked again once decoded: "%2E%2E/" is the parent too
    if (!isPlainName(name)) {continue;}
    if (seen.has((dir ? 'd:' : 'f:') + name)) {continue;}
    seen.add((dir ? 'd:' : 'f:') + name);
    (dir ? out.dirs : out.files).push(name);
  }
  return out;
}

const xmlText = unescapeHtml;

/** One page of ListObjectsV2 (list-type=2, delimiter "/") for `prefix`:
 * CommonPrefixes are folders and Contents keys files, both relative to the
 * prefix. */
export function parseS3Listing(text: string, prefix: string): Listing {
  if (!/<ListBucketResult[\s>]/.test(text)) {
    const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1];
    throw new Error(code ? `The bucket refused the listing (${code})` : 'The bucket answered, but not with a ListObjectsV2 listing');
  }
  const out: Listing = { dirs: [], files: [] };
  const rel = (k: string) => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
  for (const m of text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g)) {
    const name = rel(xmlText(m[1])).replace(/\/+$/, '');
    if (isPlainName(name)) {out.dirs.push(name);}
  }
  for (const m of text.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>/g)) {
    const name = rel(xmlText(m[1]));
    if (isPlainName(name)) {out.files.push(name);}
  }
  if (/<IsTruncated>\s*true\s*<\/IsTruncated>/.test(text)) {
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(text)?.[1];
    if (next) {out.next = xmlText(next);}
  }
  return out;
}

/** The URL path (from the base) that lists `folder` ("" is the base): a
 * folder's own URL for JSON and HTML, a ListObjectsV2 query for S3. */
export function listingPath(format: ListingFormat, folder: string, opts: { startAfter?: string; token?: string } = {}): string {
  const dir = folder ? folder.replace(/\/+$/, '') + '/' : '';
  if (format !== 's3') {return '/' + dir.split('/').map(encodeURIComponent).join('/');}
  const q = new URLSearchParams({ 'list-type': '2', delimiter: '/', prefix: dir });
  if (opts.token) {q.set('continuation-token', opts.token);}
  else if (opts.startAfter) {q.set('start-after', dir + opts.startAfter);}
  return '/?' + q.toString();
}

export function parseListing(format: ListingFormat, text: string, folder: string): Listing {
  if (format === 'json') {return parseJsonListing(text);}
  if (format === 'html') {return parseHtmlListing(text);}
  return parseS3Listing(text, folder ? folder.replace(/\/+$/, '') + '/' : '');
}
