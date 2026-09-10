import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { apiFetch } from '../../../src/lib/api-client';
import { StatusBadge } from '../../../src/components/status-badge';
import { formatCurrency, colors, type InvoiceStatus } from '../../../src/lib/tokens';

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName?: string;
  status: InvoiceStatus;
  currency: string;
  total: string;
  dueDate: string;
}

const DUE_DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function InvoiceListScreen() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => apiFetch<Invoice[]>('/invoices'),
  });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Invoices</Text>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />}
        ListEmptyComponent={!isLoading ? <Text style={styles.empty}>No invoices yet.</Text> : null}
        ListFooterComponent={
          dataUpdatedAt ? <Text style={styles.staleNote}>Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}</Text> : null
        }
        renderItem={({ item }) => {
          const isOverdue = item.status === 'OVERDUE';
          return (
            <Link href={`/invoices/${item.id}`} asChild>
              <Pressable style={styles.card}>
                <View style={styles.badgeSlot}>
                  <StatusBadge status={item.status} />
                </View>
                <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
                <Text style={styles.clientName} numberOfLines={1}>
                  {item.clientName ?? '—'}
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.dueDate, isOverdue && styles.dueDateOverdue]}>
                    {item.status === 'DRAFT' ? 'Not sent yet' : `Due ${DUE_DATE.format(new Date(item.dueDate))}`}
                  </Text>
                  <Text style={styles.amount}>{formatCurrency(item.total, item.currency)}</Text>
                </View>
              </Pressable>
            </Link>
          );
        }}
      />

      <Link href="/invoices/new" asChild>
        <Pressable style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 },
  // Top-right, matching the comp — the badge sits above the number rather than
  // in the footer row.
  badgeSlot: { position: 'absolute', top: 14, right: 14, zIndex: 1 },
  invoiceNumber: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  clientName: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 },
  dueDate: { fontSize: 12, color: colors.textMuted },
  dueDateOverdue: { color: colors.danger },
  amount: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },

  staleNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 16 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { color: '#fff', fontSize: 26, lineHeight: 28 },
});
