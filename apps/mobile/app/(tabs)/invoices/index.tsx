import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { apiFetch } from '../../../src/lib/api-client';
import { StatusBadge } from '../../../src/components/status-badge';
import { Card } from '../../../src/components/card';
import { formatCurrency, colors, type InvoiceStatus } from '../../../src/lib/tokens';

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  total: string;
  dueDate: string;
}

export default function InvoiceListScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => apiFetch<Invoice[]>('/invoices'),
  });

  return (
    <View style={styles.screen}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <Text style={styles.empty}>No invoices yet.</Text> : null}
        renderItem={({ item }) => (
          <Link href={`/invoices/${item.id}`} asChild>
            <Pressable>
              <Card style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
                  <Text style={styles.dueDate}>Due {item.dueDate}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={styles.amount}>{formatCurrency(item.total, item.currency)}</Text>
                  <StatusBadge status={item.status} />
                </View>
              </Card>
            </Pressable>
          </Link>
        )}
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
  list: { padding: 16, gap: 10 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  invoiceNumber: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dueDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
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
