import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Share } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../../../src/lib/api-client';
import { StatusBadge } from '../../../src/components/status-badge';
import { Card } from '../../../src/components/card';
import { Button } from '../../../src/components/button';
import { TextField } from '../../../src/components/text-field';
import { formatCurrency, colors, type InvoiceStatus } from '../../../src/lib/tokens';

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  dueDate: string;
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => apiFetch<Invoice>(`/invoices/${id}`),
  });

  async function runAction(fn: () => Promise<unknown>) {
    setActionError(null);
    setIsActing(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setIsActing(false);
    }
  }

  if (isLoading || !invoice) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  const canSend = invoice.status === 'DRAFT';
  const canMarkPaid = invoice.status === 'SENT' || invoice.status === 'OVERDUE' || invoice.status === 'PARTIALLY_PAID';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{invoice.invoiceNumber}</Text>
        <StatusBadge status={invoice.status} />
      </View>

      <Card style={{ gap: 8 }}>
        <Row label="Subtotal" value={formatCurrency(invoice.subtotal, invoice.currency)} />
        <Row label="Tax" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
        <Row label="Discount" value={formatCurrency(invoice.discountAmount, invoice.currency)} />
        <View style={styles.divider} />
        <Row label="Total" value={formatCurrency(invoice.total, invoice.currency)} bold />
        <Row label="Due date" value={invoice.dueDate} />
      </Card>

      <View style={{ gap: 10 }}>
        {canSend ? (
          <Button label="Send invoice" loading={isActing} onPress={() => runAction(() => apiFetch(`/invoices/${id}/send`, { method: 'POST' }))} />
        ) : null}

        <Button
          label="Share"
          variant="secondary"
          onPress={() => Share.share({ message: `Invoice ${invoice.invoiceNumber} — ${formatCurrency(invoice.total, invoice.currency)}, due ${invoice.dueDate}` })}
        />

        {canMarkPaid ? (
          <View style={{ gap: 8 }}>
            <TextField label="Record payment amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
            <Button
              label="Mark paid"
              variant="secondary"
              loading={isActing}
              onPress={() => runAction(() => apiFetch(`/invoices/${id}/mark-paid`, { method: 'POST', body: { amount } }))}
            />
          </View>
        ) : null}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </View>
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  muted: { color: colors.textSecondary, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.textSecondary, fontSize: 13 },
  rowValue: { color: colors.textPrimary, fontSize: 13 },
  rowValueBold: { fontWeight: '700', fontSize: 15 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  error: { color: colors.danger, fontSize: 13 },
});
