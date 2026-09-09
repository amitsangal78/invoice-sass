import { create } from 'zustand';
import { setSecureItem, getSecureItem, deleteSecureItem } from '../lib/secure-storage';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  workspaceId: string | null;
  isHydrated: boolean;
  setSession: (accessToken: string, refreshToken: string) => Promise<void>;
  setWorkspaceId: (workspaceId: string) => Promise<void>;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  workspaceId: null,
  isHydrated: false,

  setSession: async (accessToken, refreshToken) => {
    await setSecureItem('access_token', accessToken);
    await setSecureItem('refresh_token', refreshToken);
    set({ accessToken, refreshToken });
  },

  setWorkspaceId: async (workspaceId) => {
    await setSecureItem('workspace_id', workspaceId);
    set({ workspaceId });
  },

  // Called once at app startup — restores a session across app restarts
  // (unlike apps/admin's deliberately in-memory-only session, a mobile app
  // is expected to stay logged in between opens).
  hydrate: async () => {
    const [accessToken, refreshToken, workspaceId] = await Promise.all([
      getSecureItem('access_token'),
      getSecureItem('refresh_token'),
      getSecureItem('workspace_id'),
    ]);
    set({ accessToken, refreshToken, workspaceId, isHydrated: true });
  },

  logout: async () => {
    await Promise.all([deleteSecureItem('access_token'), deleteSecureItem('refresh_token'), deleteSecureItem('workspace_id')]);
    set({ accessToken: null, refreshToken: null, workspaceId: null });
  },
}));
