import { useAuthStore } from '../store/auth-store';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

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
 * Thin client only — this file does request/response shaping, never
 * business logic (an invoice total, a status transition) computed
 * on-device (rules/mobile.md).
 */
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown; skipWorkspace?: boolean } = {}): Promise<T> {
  const { accessToken, workspaceId } = useAuthStore.getState();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (workspaceId && !options.skipWorkspace) headers['x-workspace-id'] = workspaceId;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    await useAuthStore.getState().logout();
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiClientError(res.status, json?.error?.code ?? 'unknown_error', json?.error?.message ?? 'Request failed.');
  }

  return json.data as T;
}
