import { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiClientError } from '../../../src/lib/api-client';
import { TextField } from '../../../src/components/text-field';
import { Button } from '../../../src/components/button';
import { Card } from '../../../src/components/card';
import { colors } from '../../../src/lib/tokens';

interface Client {
  id: string;
  name: string;
  email: string;
}

export default function ClientsScreen() {
  const queryClient = useQueryClient();
  const { data: clients, isLoading } = useQuery({ queryKey: ['clients'], queryFn: () => apiFetch<Client[]>('/clients') });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleCreate() {
    setError(null);
    setIsPending(true);
    try {
      await apiFetch('/clients', { method: 'POST', body: { name, email } });
      setName('');
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={clients ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.form}>
            <Text style={styles.sectionLabel}>Add client</Text>
            <TextField label="Name" value={name} onChangeText={setName} />
            <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={isPending ? 'Adding…' : 'Add client'} onPress={handleCreate} loading={isPending} />
            <Text style={styles.sectionLabel}>Clients</Text>
          </View>
        }
        ListEmptyComponent={!isLoading ? <Text style={styles.empty}>No clients yet.</Text> : null}
        renderItem={({ item }) => (
          <Card style={styles.clientCard}>
            <Text style={styles.clientName}>{item.name}</Text>
            <Text style={styles.clientEmail}>{item.email}</Text>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 10 },
  form: { gap: 10, marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: 8 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 20 },
  clientCard: { marginBottom: 8 },
  clientName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  clientEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13 },
});
