import { useAuthStore } from '@/store/auth-store';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

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
 * Client-side fetch wrapper — every call goes through the admin console's
 * own auth, never the tenant session (rules/frontend-admin.md: this app's
 * routes and auth session are entirely separate from the tenant app's).
 */
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    useAuthStore.getState().logout();
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiClientError(res.status, json?.error?.code ?? 'unknown_error', json?.error?.message ?? 'Request failed.');
  }

  return json.data as T;
}
