import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../src/lib/api-client';
import { formatCurrency, colors, type InvoiceStatus } from '../../src/lib/tokens';

interface CurrencyTotal {
  currency: string;
  amount: string;
}
interface RecentPayment {
  paymentId: string;
  clientName: string;
  amount: string;
  currency: string;
  paidAt: string;
}
interface DashboardSummary {
  outstanding: CurrencyTotal[];
  overdue: CurrencyTotal[];
  recentPayments: RecentPayment[];
}
interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
}

const OUTSTANDING_STATUSES: InvoiceStatus[] = ['SENT', 'OVERDUE', 'PARTIALLY_PAID'];

function relativeTime(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Multi-currency workspaces get a line per currency — totals are never summed
 * across currencies (core-invoicing requirements). */
function totalsLabel(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return '—';
  return totals.map((t) => formatCurrency(t.amount, t.currency)).join('  ·  ');
}

export default function HomeScreen() {
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<DashboardSummary>('/dashboard/summary'),
  });
  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: () => apiFetch<InvoiceRow[]>('/invoices'),
  });

  const outstandingCount = (invoices.data ?? []).filter((i) => OUTSTANDING_STATUSES.includes(i.status)).length;
  const isRefreshing = (summary.isFetching && !summary.isLoading) || (invoices.isFetching && !invoices.isLoading);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => {
            void summary.refetch();
            void invoices.refetch();
          }}
        />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello there</Text>
          <Text style={styles.subGreeting}>Here&apos;s your business today</Text>
        </View>
      </View>

      {summary.isLoading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : (
        <>
          <View style={styles.outstandingCard}>
            <Text style={styles.outstandingLabel}>Outstanding</Text>
            <Text style={styles.outstandingValue}>{totalsLabel(summary.data?.outstanding ?? [])}</Text>
            <Text style={styles.outstandingMeta}>
              Across {outstandingCount} invoice{outstandingCount === 1 ? '' : 's'}
            </Text>
          </View>

          <View style={styles.overdueCard}>
            <View>
              <Text style={styles.overdueLabel}>Overdue</Text>
              <Text style={styles.overdueValue}>{totalsLabel(summary.data?.overdue ?? [])}</Text>
            </View>
            <View style={styles.overdueIcon}>
              <Text style={styles.overdueIconGlyph}>!</Text>
            </View>
          </View>

          <View>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {(summary.data?.recentPayments ?? []).length === 0 ? (
              <Text style={styles.muted}>No payments recorded yet.</Text>
            ) : (
              <View style={{ gap: 12 }}>
                {summary.data!.recentPayments.map((payment) => (
                  <View key={payment.paymentId} style={styles.activityRow}>
                    <View style={styles.activityIcon}>
                      <Text style={styles.activityIconGlyph}>✓</Text>
                    </View>
                    <View style={styles.activityBody}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {payment.clientName} paid
                      </Text>
                      <Text style={styles.activityMeta}>{relativeTime(payment.paidAt)}</Text>
                    </View>
                    <Text style={styles.activityAmount}>{formatCurrency(payment.amount, payment.currency)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      )}

      {/* rules/mobile.md: cached/stale data must be visibly marked, never
          shown as if it's live. */}
      {summary.dataUpdatedAt ? <Text style={styles.staleNote}>Last updated {new Date(summary.dataUpdatedAt).toLocaleTimeString()}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 24, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subGreeting: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  muted: { color: colors.textSecondary, fontSize: 13 },

  outstandingCard: { backgroundColor: colors.primary, borderRadius: 12, padding: 20 },
  outstandingLabel: { fontSize: 13, color: '#FFFFFF', opacity: 0.85 },
  outstandingValue: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  outstandingMeta: { fontSize: 12, color: '#FFFFFF', opacity: 0.8, marginTop: 6 },

  overdueCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overdueLabel: { fontSize: 13, color: colors.textSecondary },
  overdueValue: { fontSize: 20, fontWeight: '700', color: colors.danger, marginTop: 2 },
  overdueIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  overdueIconGlyph: { color: colors.danger, fontSize: 20, fontWeight: '700' },

  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  activityIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  activityIconGlyph: { color: colors.success, fontSize: 15, fontWeight: '700' },
  activityBody: { flex: 1, minWidth: 0 },
  activityTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  activityMeta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  activityAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },

  staleNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },
});
