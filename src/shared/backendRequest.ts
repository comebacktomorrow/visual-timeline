import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import type { ProxyRequest } from './proxy';

/* Grafana's own HTTP client: it adds the org header, honours a sub-path
 * install, and sends the session cookie that the data source proxy checks. */
export const backendRequest: ProxyRequest = (options) => lastValueFrom(getBackendSrv().fetch(options));
