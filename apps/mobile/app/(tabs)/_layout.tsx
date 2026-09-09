import { Tabs, Redirect } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useAuthStore } from '../../src/store/auth-store';
import { colors } from '../../src/lib/tokens';

// ColorValue, not string — that's what expo-router hands tabBarIcon, and it's
// what Text's style.color accepts, so it passes straight through.
function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Wait for hydrate() to finish before deciding — otherwise a real session
  // restored from SecureStore would flash a redirect to /login on cold start.
  if (!isHydrated) return null;
  if (!accessToken) return <Redirect href="/login" />;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.textMuted }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }} />
      <Tabs.Screen name="invoices" options={{ title: 'Invoices', tabBarIcon: ({ color }) => <TabIcon symbol="▤" color={color} /> }} />
      <Tabs.Screen name="clients" options={{ title: 'Clients', tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color }) => <TabIcon symbol="⋯" color={color} /> }} />
    </Tabs>
  );
}
