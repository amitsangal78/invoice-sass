import { cookies } from 'next/headers';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Server-only fetch wrapper. Tokens live in httpOnly cookies, never exposed
 * to client-side JS — satisfies requirements/frontend-web.md's "auth tokens
 * never in plain localStorage" rule by construction rather than by
 * discipline. Every Server Component / Server Action that talks to the API
 * goes through this (architecture-principles.md #1 — server-first by
 * default; #2 — UI never calls an integration directly, always through our
 * own layer).
 *
 * Known limitation, stated plainly: this does not silently refresh an
 * expired access token mid-request — a 401 propagates as ApiClientError and
 * callers redirect to /login. Transparent refresh (matching the access
 * token's 15-minute lifetime) is a follow-up, not implemented in this pass.
 */
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown; workspaceId?: string } = {}): Promise<T> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.workspaceId) headers['x-workspace-id'] = options.workspaceId;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store', // authenticated responses are never cached (requirements/frontend-web.md)
  });

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiClientError(res.status, json?.error?.code ?? 'unknown_error', json?.error?.message ?? 'Request failed.');
  }

  return json.data as T;
}

/** Every feature's server-side fetch needs this — centralized so the cookie
 * name isn't repeated per call site. */
export async function getWorkspaceId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get('workspace_id')?.value;
}
