import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../src/lib/api-client';
import { Card } from '../../src/components/card';
import { formatCurrency, colors } from '../../src/lib/tokens';

interface CurrencyTotal {
  currency: string;
  amount: string;
}
interface DashboardSummary {
  outstanding: CurrencyTotal[];
  paid: CurrencyTotal[];
}

export default function HomeScreen() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<DashboardSummary>('/dashboard/summary'),
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}>
      <Text style={styles.title}>Dashboard</Text>

      {isLoading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <TotalsCard label="Outstanding" totals={data?.outstanding ?? []} />
          <TotalsCard label="Paid" totals={data?.paid ?? []} />
        </View>
      )}

      {/* rules/mobile.md: cached/stale data must be visibly marked, never
          shown as if it's live. */}
      {dataUpdatedAt ? <Text style={styles.staleNote}>Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}</Text> : null}
    </ScrollView>
  );
}

function TotalsCard({ label, totals }: { label: string; totals: CurrencyTotal[] }) {
  return (
    <Card>
      <Text style={styles.cardLabel}>{label}</Text>
      {totals.length === 0 ? (
        <Text style={styles.cardValue}>—</Text>
      ) : (
        totals.map((t) => (
          <Text key={t.currency} style={styles.cardValue}>
            {formatCurrency(t.amount, t.currency)}
          </Text>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  muted: { color: colors.textSecondary },
  cardLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  cardValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  staleNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },
});
