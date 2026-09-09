import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth-store';

// Presence-only check, same honest limitation as apps/web's middleware —
// real authorization happens server-side on every /admin/* call via
// requirePlatformRole. This just avoids rendering the shell for someone
// with no session at all.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
