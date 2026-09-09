import { create } from 'zustand';

export interface AdminUser {
  id: string;
  email: string;
  platformRole: 'SUPER_ADMIN' | 'SUPPORT_ADMIN';
}

interface AuthState {
  accessToken: string | null;
  user: AdminUser | null;
  setSession: (accessToken: string, user: AdminUser) => void;
  logout: () => void;
}

/**
 * Deliberately NOT persisted (no zustand `persist` middleware, no
 * localStorage) — requirements/frontend-web.md's "auth tokens never in
 * plain localStorage" rule applies here too. A Vite SPA has no server layer
 * to hold an httpOnly cookie the way apps/web does, so the honest trade-off
 * for this internal tool is: in-memory only, lost on page refresh, requiring
 * re-login. Acceptable for a low-traffic internal ops console; a real
 * backend-for-frontend session layer is a follow-up if this becomes a
 * heavier-use tool.
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  logout: () => set({ accessToken: null, user: null }),
}));
