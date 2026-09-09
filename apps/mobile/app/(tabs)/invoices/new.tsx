import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../../../src/lib/api-client';
import { TextField } from '../../../src/components/text-field';
import { Button } from '../../../src/components/button';
import { Card } from '../../../src/components/card';
import { colors } from '../../../src/lib/tokens';

interface Client {
  id: string;
  name: string;
}

// Mobile creates a SIMPLE invoice only (basic line items, no advanced tax/
// discount editing) — complex invoice editing stays web-only
// (steering/product.md's mobile scope).
export default function NewInvoiceScreen() {
  const queryClient = useQueryClient();
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: () => apiFetch<Client[]>('/clients') });

  const [clientId, setClientId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleCreate() {
    if (!clientId) {
      setError('Select a client.');
      return;
    }
    setError(null);
    setIsPending(true);
    try {
      const invoice = await apiFetch<{ id: string }>('/invoices', {
        method: 'POST',
        body: { clientId, currency, dueDate, items: [{ description, quantity, unitPrice }] },
      });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.replace(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Client</Text>
      <View style={{ gap: 8 }}>
        {(clients ?? []).map((c) => (
          <Pressable key={c.id} onPress={() => setClientId(c.id)}>
            <Card style={clientId === c.id ? styles.clientCardSelected : undefined}>
              <Text style={styles.clientName}>{c.name}</Text>
            </Card>
          </Pressable>
        ))}
      </View>

      <TextField label="Description" value={description} onChangeText={setDescription} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Unit price" value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TextField label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={isPending ? 'Creating…' : 'Create invoice'} onPress={handleCreate} loading={isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  clientName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  clientCardSelected: { borderColor: colors.primary, borderWidth: 2 },
  error: { color: colors.danger, fontSize: 13 },
});
