'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/api/server-client';

const ACCESS_TOKEN_MAX_AGE = 15 * 60; // 15 min — matches the backend's access token lifetime
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days — matches identity-and-rbac/design.md

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; platformRole: string };
}

interface WorkspaceMembership {
  workspaceId: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  isOwner: boolean;
}

export interface AuthFormState {
  error?: string;
}

async function setAuthCookies(result: LoginResult) {
  const cookieStore = await cookies();
  const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  cookieStore.set('access_token', result.accessToken, { ...cookieOpts, maxAge: ACCESS_TOKEN_MAX_AGE });
  cookieStore.set('refresh_token', result.refreshToken, { ...cookieOpts, maxAge: REFRESH_TOKEN_MAX_AGE });
}

/** After login, resolve which workspace to operate in — single-workspace
 * users skip straight through; multi-workspace users land on a picker
 * (design-system.md's "Resolved decisions": auto-select on single
 * membership, otherwise let the user choose). */
async function resolveWorkspaceAndRedirect() {
  const workspaces = await apiFetch<WorkspaceMembership[]>('/workspaces/mine');

  if (workspaces.length === 0) {
    redirect('/login?error=no_workspace');
  }

  if (workspaces.length === 1) {
    const cookieStore = await cookies();
    cookieStore.set('workspace_id', workspaces[0]!.workspaceId, { httpOnly: false, sameSite: 'lax', path: '/' });
    redirect('/dashboard');
  }

  redirect('/select-workspace');
}

export async function loginAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  let result: LoginResult;
  try {
    result = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
  } catch (err) {
    if (err instanceof ApiClientError) return { error: err.message };
    return { error: 'Something went wrong. Please try again.' };
  }

  await setAuthCookies(result);
  await resolveWorkspaceAndRedirect();
  return {};
}

export async function signupAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const workspaceName = String(formData.get('workspaceName') ?? '');

  try {
    await apiFetch('/auth/signup', { method: 'POST', body: { email, password, workspaceName } });
  } catch (err) {
    if (err instanceof ApiClientError) return { error: err.message };
    return { error: 'Something went wrong. Please try again.' };
  }

  // Signup doesn't issue a session (identity-and-rbac/design.md — verification
  // is nudged, not required, but login is a separate explicit step).
  const loginResult = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
  await setAuthCookies(loginResult);
  await resolveWorkspaceAndRedirect();
  return {};
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;
  if (refreshToken) {
    await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
  }
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
  cookieStore.delete('workspace_id');
  redirect('/login');
}

export async function selectWorkspaceAction(workspaceId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set('workspace_id', workspaceId, { httpOnly: false, sameSite: 'lax', path: '/' });
  redirect('/dashboard');
}
