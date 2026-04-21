/**
 * graphClient — Thin HTTP wrapper over https://graph.microsoft.com/v1.0.
 *
 * Handles bearer injection, 401 → refresh → retry once, and
 * exponential backoff for 429/503 (respecting Retry-After).
 *
 * Spec 11 §5 / §8.2 / §9.
 */

import { getAccessToken } from './graphAuthService';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphFetchOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | undefined>;
  body?: any;
  /** Disable the automatic 401 → refresh retry (used from auth code itself). */
  skipAuthRefresh?: boolean;
  /** Max backoff attempts for transient errors. Default 3. */
  maxRetries?: number;
  /** Optional signal to abort the request. */
  signal?: AbortSignal;
}

export class GraphAuthError extends Error {
  constructor(msg: string) { super(msg); this.name = 'GraphAuthError'; }
}

export class GraphHttpError extends Error {
  constructor(public status: number, public body: string, msg: string) {
    super(msg); this.name = 'GraphHttpError';
  }
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Perform a Graph API request with auth + retry. Returns parsed JSON.
 *
 * Refreshes the access token once on 401. Retries 429/503 up to `maxRetries`
 * with exponential backoff honoring the `Retry-After` header when present.
 */
export async function graphFetch<T = any>(db: any, path: string, opts: GraphFetchOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  let attempt = 0;
  let refreshed = false;

  while (true) {
    attempt++;
    const token = await getAccessToken(db);
    if (!token) throw new GraphAuthError('not_connected');

    const url = buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (err: any) {
      if (attempt > maxRetries) throw err;
      await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
      continue;
    }

    // 401 → refresh once, then retry
    if (res.status === 401 && !opts.skipAuthRefresh && !refreshed) {
      refreshed = true;
      const { refreshAccessToken } = await import('./graphAuthService');
      const ok = await refreshAccessToken(db);
      if (!ok) throw new GraphAuthError('refresh_failed');
      continue;
    }

    // 429 / 503 → backoff
    if ((res.status === 429 || res.status === 503) && attempt <= maxRetries) {
      const retryAfter = res.headers.get('retry-after');
      const waitSec = retryAfter ? Number(retryAfter) : Math.min(8, 2 ** (attempt - 1));
      await sleep(Math.max(500, (isFinite(waitSec) ? waitSec : 2) * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GraphHttpError(res.status, text, `graph ${res.status} ${path}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    // Some endpoints (logout) return empty body
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return undefined as unknown as T;
    return (await res.json()) as T;
  }
}

/**
 * Iterate a paginated `value[]` endpoint via `@odata.nextLink`.
 * Stops when `stop(item)` returns true for an item (timestamp cutoff) OR
 * when `pageCap` pages have been fetched. Prevents runaway paginations.
 */
export async function graphFetchPaged<T>(
  db: any,
  path: string,
  opts: GraphFetchOptions & { stop?: (item: T) => boolean; pageCap?: number } = {},
): Promise<T[]> {
  const pageCap = opts.pageCap ?? 20;
  const all: T[] = [];
  let url: string | undefined = path;
  let pages = 0;

  while (url && pages < pageCap) {
    const data: any = await graphFetch<any>(db, url, { ...opts, query: pages === 0 ? opts.query : undefined });
    const items: T[] = Array.isArray(data?.value) ? data.value : [];
    for (const it of items) {
      if (opts.stop && opts.stop(it)) return all;
      all.push(it);
    }
    url = data?.['@odata.nextLink'];
    pages++;
  }
  return all;
}

