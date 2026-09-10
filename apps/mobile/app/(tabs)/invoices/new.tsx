import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../../../src/lib/api-client';
import { TextField } from '../../../src/components/text-field';
import { formatCurrency, colors } from '../../../src/lib/tokens';

interface Client {
  id: string;
  name: string;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

const STEPS = ['Client', 'Details', 'Items', 'Review', 'Send'] as const;

// Mobile creates a SIMPLE invoice only (basic line items, no advanced tax/
// discount editing) — complex invoice editing stays web-only
// (steering/product.md's mobile scope).
export default function NewInvoiceScreen() {
  const queryClient = useQueryClient();
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: () => apiFetch<Client[]>('/clients') });

  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: '1', unitPrice: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Display only — the API recomputes the authoritative total with decimal-safe
  // math on create (rules/mobile.md: business logic stays server-side).
  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function validateStep(): string | null {
    if (step === 0 && !clientId) return 'Select a client to continue.';
    if (step === 1 && !dueDate.trim()) return 'A due date is required (YYYY-MM-DD).';
    if (step === 2) {
      if (items.length === 0) return 'Add at least one line item.';
      const incomplete = items.some((i) => !i.description.trim() || !i.unitPrice.trim());
      if (incomplete) return 'Every line item needs a description and price.';
    }
    return null;
  }

  function goNext() {
    const problem = validateStep();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function handleCreate(alsoSend: boolean) {
    setError(null);
    setIsPending(true);
    try {
      const invoice = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST',
        body: { clientId, currency, dueDate, items },
      });
      if (alsoSend) {
        await apiFetch(`/invoices/${invoice.id}/send`, { method: 'POST' });
      }
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      router.replace(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create the invoice.');
    } finally {
      setIsPending(false);
    }
  }

  const selectedClient = clients?.find((c) => c.id === clientId);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>New Invoice</Text>
        <View style={styles.stepRow}>
          {STEPS.map((label, index) => (
            <View key={label} style={styles.stepGroup}>
              {index > 0 ? <View style={[styles.connector, index <= step && styles.connectorDone]} /> : null}
              <View style={styles.stepItem}>
                <View style={[styles.stepDot, index < step && styles.stepDotDone, index === step && styles.stepDotCurrent]}>
                  <Text style={[styles.stepDotText, index <= step && styles.stepDotTextActive]}>{index < step ? '✓' : String(index + 1)}</Text>
                </View>
                <Text style={[styles.stepLabel, index < step && styles.stepLabelDone, index === step && styles.stepLabelCurrent]}>{label}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {step === 0 ? (
          <>
            <Text style={styles.sectionTitle}>Client</Text>
            {(clients ?? []).map((client) => (
              <Pressable
                key={client.id}
                onPress={() => setClientId(client.id)}
                style={[styles.selectRow, clientId === client.id && styles.selectRowActive]}
              >
                <Text style={[styles.selectText, clientId === client.id && styles.selectTextActive]}>{client.name}</Text>
              </Pressable>
            ))}
            {clients?.length === 0 ? <Text style={styles.muted}>No clients yet — add one from the Clients tab first.</Text> : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={styles.sectionTitle}>Details</Text>
            <TextField label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
            <TextField label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-12-31" />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={styles.sectionTitle}>Line Items</Text>
            {items.map((item, index) => (
              <View key={index} style={styles.itemCard}>
                <TextField
                  value={item.description}
                  onChangeText={(text) => updateItem(index, { description: text })}
                  placeholder="Description"
                />
                <View style={styles.itemRow}>
                  <View style={styles.qtyField}>
                    <Text style={styles.fieldCaption}>Qty</Text>
                    <TextField value={item.quantity} onChangeText={(t) => updateItem(index, { quantity: t })} keyboardType="numeric" />
                  </View>
                  <View style={styles.priceField}>
                    <Text style={styles.fieldCaption}>Price</Text>
                    <TextField value={item.unitPrice} onChangeText={(t) => updateItem(index, { unitPrice: t })} keyboardType="numeric" />
                  </View>
                </View>
                {items.length > 1 ? (
                  <Pressable onPress={() => setItems((cur) => cur.filter((_, i) => i !== index))}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable style={styles.addItem} onPress={() => setItems((cur) => [...cur, { description: '', quantity: '1', unitPrice: '' }])}>
              <Text style={styles.addItemText}>+  Add item</Text>
            </Pressable>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text style={styles.sectionTitle}>Review</Text>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Client</Text>
              <Text style={styles.reviewValue}>{selectedClient?.name ?? '—'}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Due date</Text>
              <Text style={styles.reviewValue}>{dueDate}</Text>
            </View>
            {items.map((item, index) => (
              <View key={index} style={styles.reviewRow}>
                <Text style={styles.reviewLabel} numberOfLines={1}>
                  {item.description} × {item.quantity}
                </Text>
                <Text style={styles.reviewValue}>
                  {formatCurrency(String((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), currency)}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text style={styles.sectionTitle}>Send</Text>
            <Text style={styles.muted}>
              Create this invoice as a draft, or create and send it to {selectedClient?.name ?? 'the client'} straight away.
            </Text>
            <Pressable style={styles.primaryWide} disabled={isPending} onPress={() => handleCreate(true)}>
              <Text style={styles.primaryWideText}>{isPending ? 'Working…' : 'Create and send'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryWide} disabled={isPending} onPress={() => handleCreate(false)}>
              <Text style={styles.secondaryWideText}>Save as draft</Text>
            </Pressable>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>{formatCurrency(String(subtotal), currency)}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.backButton} disabled={step === 0} onPress={() => setStep((s) => Math.max(s - 1, 0))}>
            <Text style={[styles.backText, step === 0 && styles.backTextDisabled]}>Back</Text>
          </Pressable>
          {step < STEPS.length - 1 ? (
            <Pressable style={styles.nextButton} onPress={goNext}>
              <Text style={styles.nextText}>Next</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 16 },
  title: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepGroup: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  connector: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 4, marginBottom: 16 },
  connectorDone: { backgroundColor: colors.primary },
  stepItem: { alignItems: 'center', gap: 6 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: '#DCFCE7' },
  stepDotCurrent: { backgroundColor: colors.primary },
  stepDotText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  stepDotTextActive: { color: '#FFFFFF' },
  stepLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '500' },
  stepLabelDone: { color: colors.success, fontWeight: '600' },
  stepLabelCurrent: { color: colors.primary, fontWeight: '700' },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  muted: { fontSize: 13, color: colors.textSecondary },

  selectRow: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, backgroundColor: colors.surface },
  selectRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  selectText: { fontSize: 14, color: colors.textPrimary },
  selectTextActive: { color: colors.primary, fontWeight: '700' },

  itemCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 10, backgroundColor: colors.surface },
  itemRow: { flexDirection: 'row', gap: 10 },
  qtyField: { flex: 1 },
  priceField: { flex: 2 },
  fieldCaption: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  removeText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
  addItem: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#93C5FD', borderRadius: 12, padding: 14, alignItems: 'center' },
  addItemText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  reviewLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  reviewValue: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },

  primaryWide: { backgroundColor: colors.primary, borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryWideText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  secondaryWide: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, alignItems: 'center' },
  secondaryWideText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  error: { fontSize: 13, color: colors.danger },

  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 12 },
  subtotalRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  subtotalLabel: { fontSize: 13, color: colors.textSecondary },
  subtotalValue: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: 12 },
  backButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 13, alignItems: 'center' },
  backText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  backTextDisabled: { color: colors.textMuted },
  nextButton: { flex: 2, backgroundColor: colors.primary, borderRadius: 8, padding: 13, alignItems: 'center' },
  nextText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
