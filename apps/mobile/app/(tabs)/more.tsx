import { View, Text, StyleSheet, Linking } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { apiFetch } from '../../src/lib/api-client';
import { useAuthStore } from '../../src/store/auth-store';
import { Card } from '../../src/components/card';
import { Button } from '../../src/components/button';
import { colors } from '../../src/lib/tokens';

interface Subscription {
  plan: 'FREE' | 'STARTER' | 'PRO';
  status: string;
  currentPeriodEnd: string | null;
}

// Read-only plan display + "Manage on web" — no StoreKit/Play Billing,
// no in-app purchase (product.md's explicit exclusion, tested at the
// backend but restated here since this is the one screen that could
// tempt someone into adding IAP later).
export default function MoreScreen() {
  const logout = useAuthStore((s) => s.logout);
  const { data: subscription } = useQuery({ queryKey: ['billing-plan'], queryFn: () => apiFetch<Subscription>('/billing/plan') });

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <View style={styles.screen}>
      <Card style={{ gap: 8 }}>
        <Text style={styles.label}>Current plan</Text>
        <Text style={styles.plan}>{subscription?.plan ?? '—'}</Text>
        {subscription?.currentPeriodEnd ? <Text style={styles.renewal}>Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</Text> : null}
        <Button label="Manage subscription on web" variant="secondary" onPress={() => Linking.openURL('https://app.billify.example.com/settings/billing')} />
      </Card>

      <Button label="Log out" variant="danger" onPress={handleLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 20, gap: 16 },
  label: { fontSize: 13, color: colors.textSecondary },
  plan: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  renewal: { fontSize: 12, color: colors.textMuted },
});
