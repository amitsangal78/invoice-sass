import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store/auth-store';

export default function RootIndex() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  if (!isHydrated) return null;
  return <Redirect href={accessToken ? '/(tabs)' : '/login'} />;
}
