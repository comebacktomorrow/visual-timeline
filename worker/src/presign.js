/* SigV4 query-string signing (AWS Signature Version 4, presigned GET), for
 * R2's S3 endpoint. WebCrypto only, no dependencies: the reference worker
 * stays a couple of plain modules. */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 encoding, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ */
export const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/* The signing key depends only on the secret, the day and the scope, so it's
 * derived once a day per isolate. */
const signingKeys = new Map();

/** A SigV4 query-signed GET URL for `path` (encoded, from the root) on
 * `host`, signed as of `at` (ms) and valid for `expires` seconds. */
export async function presignUrl({ id, secret, region, service = 's3' }, host, path, at, expires) {
  const amzDate = new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${id}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const query = params.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join('&');
  const canonical = ['GET', path, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(await crypto.subtle.digest('SHA-256', enc.encode(canonical)))].join('\n');
  const keyId = `${id}|${day}|${region}|${service}`;
  let key = signingKeys.get(keyId);
  if (!key) {
    key = await hmac(await hmac(await hmac(await hmac('AWS4' + secret, day), region), service), 'aws4_request');
    if (signingKeys.size > 8) {signingKeys.clear();}
    signingKeys.set(keyId, key);
  }
  return `https://${host}${path}?${query}&X-Amz-Signature=${hex(await hmac(key, toSign))}`;
}
