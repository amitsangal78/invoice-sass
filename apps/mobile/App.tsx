import { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { healthResponse, policy, type Actor } from '@invoice/contracts';

export default function App() {
  const [base, setBase] = useState(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000');
  const [status, setStatus] = useState('Not checked');
  const [busy, setBusy] = useState(false);

  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Data state
  const [tab, setTab] = useState<'INVOICES' | 'CREATORS' | 'NEW_INVOICE'>('INVOICES');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [creators, setCreators] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);

  // New Invoice Draft state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [itemQuantity, setItemQuantity] = useState('1');

  async function checkConnection() {
    setBusy(true);
    try {
      const response = await fetch(`${base}/api/v1/health/live`);
      if (!response.ok) throw new Error('unavailable');
      healthResponse.parse(await response.json());
      setStatus('Connected to test API');
    } catch {
      setStatus('API unavailable. Check local API server.');
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, client_type: 'MOBILE' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Login failed');
      setToken(data.data.session_token);
      setActor(data.data.actor);
      setPassword('');
      await loadData(data.data.session_token, data.data.actor);
    } catch (e: any) {
      Alert.alert('Login Error', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!token) return;
    try {
      await fetch(`${base}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
    setToken(null);
    setActor(null);
    setInvoices([]);
    setCreators([]);
  }

  async function loadData(authToken: string, currentActor: Actor) {
    try {
      const invRes = await fetch(`${base}/api/v1/invoices`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (invRes.ok) {
        const invData = await invRes.json();
        setInvoices(invData.data ?? []);
      }

      if (currentActor.role === 'OWNER') {
        const crRes = await fetch(`${base}/api/v1/vendor/creators`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (crRes.ok) {
          const crData = await crRes.json();
          setCreators(crData.data ?? []);
        }
      }

      const custRes = await fetch(`${base}/api/v1/invoice-options/customers`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomers(custData.data ?? []);
        if (custData.data?.length > 0) setSelectedCustomerId(custData.data[0].id);
      }

      const itemRes = await fetch(`${base}/api/v1/invoice-options/items`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        setItems(itemData.data ?? []);
        if (itemData.data?.length > 0) setSelectedItemId(itemData.data[0].id);
      }
    } catch {}
  }

  async function createDraft() {
    if (!token || !selectedCustomerId || !selectedItemId) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/v1/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customer_id: selectedCustomerId,
          lines: [{ catalogue_item_id: selectedItemId, quantity: Number(itemQuantity) || 1 }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed to create invoice');
      Alert.alert('Success', 'Invoice draft created!');
      setTab('INVOICES');
      if (actor) await loadData(token, actor);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.brand}>
          <Text style={styles.wordmark}>invoice workspace</Text>
          <Text style={styles.pill}>TEST MODE</Text>
        </View>

        {!actor ? (
          <View>
            <Text style={styles.kicker}>MOBILE WORKSPACE</Text>
            <Text style={styles.title}>Sign in on mobile.</Text>
            <Text style={styles.intro}>Owner and Creator workflows with role-based access.</Text>

            <View style={styles.card}>
              <Text style={styles.label}>SIGN IN</Text>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor="#899"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#899"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy}
                onPress={login}
                style={styles.button}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In →</Text>}
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { marginTop: 20 }]}>
              <Text style={styles.label}>API SERVER</Text>
              <Text style={styles.body}>{status}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busy}
                onPress={checkConnection}
                style={[styles.button, { marginTop: 12, backgroundColor: '#3d5a57' }]}
              >
                <Text style={styles.buttonText}>Test API Ping</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            {/* User details header */}
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.kicker}>SIGNED IN</Text>
              <Text style={[styles.heading, { color: '#f3f6ed', marginTop: 4 }]}>{actor.email}</Text>
              <Text style={{ color: '#cee4b7', fontSize: 13, marginTop: 2 }}>
                {actor.role.replaceAll('_', ' ')} · {actor.vendor_status ?? 'Active'}
              </Text>
            </View>

            {/* Navigation Tabs */}
            <View style={styles.tabBar}>
              <TouchableOpacity onPress={() => setTab('INVOICES')} style={[styles.tabItem, tab === 'INVOICES' && styles.tabActive]}>
                <Text style={[styles.tabText, tab === 'INVOICES' && styles.tabTextActive]}>Invoices ({invoices.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTab('NEW_INVOICE')} style={[styles.tabItem, tab === 'NEW_INVOICE' && styles.tabActive]}>
                <Text style={[styles.tabText, tab === 'NEW_INVOICE' && styles.tabTextActive]}>+ New Draft</Text>
              </TouchableOpacity>
              {actor.role === 'OWNER' && (
                <TouchableOpacity onPress={() => setTab('CREATORS')} style={[styles.tabItem, tab === 'CREATORS' && styles.tabActive]}>
                  <Text style={[styles.tabText, tab === 'CREATORS' && styles.tabTextActive]}>Creators ({creators.length})</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Tab: INVOICES */}
            {tab === 'INVOICES' && (
              <View>
                {invoices.map(inv => (
                  <View key={inv.id} style={[styles.card, { marginBottom: 12 }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '700', fontSize: 16, color: '#183d43' }}>
                        {inv.invoice_number ?? 'DRAFT'}
                      </Text>
                      <Text style={[styles.pill, { color: '#163b43', backgroundColor: '#e2edda', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }]}>
                        {inv.document_state === 'ISSUED' ? 'ISSUED' : inv.approval_state}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 13, color: '#62766e', marginTop: 4 }}>{inv.customer_name}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e0e6df' }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#183d43' }}>Total: ₹{inv.total}</Text>
                      <Text style={{ fontSize: 13, color: inv.outstanding_amount === 0 ? '#2e6930' : '#8c4031' }}>
                        Due: ₹{inv.outstanding_amount}
                      </Text>
                    </View>
                  </View>
                ))}
                {invoices.length === 0 && (
                  <Text style={{ color: '#bfd1cc', textAlign: 'center', marginTop: 20 }}>No invoices found.</Text>
                )}
              </View>
            )}

            {/* Tab: NEW_INVOICE */}
            {tab === 'NEW_INVOICE' && (
              <View style={styles.card}>
                <Text style={styles.heading}>Prepare Invoice</Text>
                <Text style={{ fontSize: 12, color: '#62766e', marginBottom: 16 }}>
                  Select customer, choose item and specify quantity.
                </Text>

                <Text style={styles.label}>CUSTOMER</Text>
                {customers.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setSelectedCustomerId(c.id)}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      backgroundColor: selectedCustomerId === c.id ? '#e2edda' : '#fff',
                      borderWidth: 1,
                      borderColor: selectedCustomerId === c.id ? '#173d43' : '#ced8d2',
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ fontWeight: selectedCustomerId === c.id ? '700' : '400', color: '#183d43' }}>
                      {c.name} ({c.email})
                    </Text>
                  </TouchableOpacity>
                ))}

                <Text style={[styles.label, { marginTop: 14 }]}>ITEM / SERVICE</Text>
                {items.map(it => (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => setSelectedItemId(it.id)}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      backgroundColor: selectedItemId === it.id ? '#e2edda' : '#fff',
                      borderWidth: 1,
                      borderColor: selectedItemId === it.id ? '#173d43' : '#ced8d2',
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ fontWeight: selectedItemId === it.id ? '700' : '400', color: '#183d43' }}>
                      {it.name} - ₹{it.unit_price}/{it.unit}
                    </Text>
                  </TouchableOpacity>
                ))}

                <Text style={[styles.label, { marginTop: 14 }]}>QUANTITY</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={itemQuantity}
                  onChangeText={setItemQuantity}
                />

                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={createDraft}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{busy ? 'Creating…' : 'Create Invoice Draft →'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Tab: CREATORS (Owner only) */}
            {tab === 'CREATORS' && actor.role === 'OWNER' && (
              <View>
                {creators.map(cr => (
                  <View key={cr.id} style={[styles.card, { marginBottom: 10 }]}>
                    <Text style={{ fontWeight: '700', fontSize: 15, color: '#183d43' }}>{cr.email}</Text>
                    <Text style={{ fontSize: 12, color: '#62766e', marginTop: 4 }}>Status: {cr.status}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity onPress={logout} style={{ marginTop: 24, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: '#cee4b7', fontSize: 14 }}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.footer}>{policy.paymentMode} money only · Owner and Creator workflows</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#163b43' },
  page: { padding: 22, paddingTop: 30, paddingBottom: 50 },
  brand: { gap: 8, marginBottom: 24 },
  wordmark: { fontSize: 22, fontWeight: '700', color: '#f3f6ed' },
  pill: { fontSize: 9, letterSpacing: 1.5, color: '#cee4b7' },
  kicker: { fontSize: 10, letterSpacing: 2, color: '#c8e0bd' },
  title: { fontSize: 32, lineHeight: 38, color: '#f6f6ee', fontWeight: '600', marginTop: 8 },
  intro: { fontSize: 14, lineHeight: 22, color: '#bfd1cc', marginTop: 12, marginBottom: 24 },
  card: { backgroundColor: '#f5f6ee', borderRadius: 10, padding: 20 },
  label: { fontSize: 10, letterSpacing: 1.2, color: '#718466', fontWeight: '700', marginBottom: 6 },
  heading: { fontSize: 20, lineHeight: 26, color: '#183d43', fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 20, color: '#62766e', marginTop: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ced8d2',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    color: '#183d43',
    marginBottom: 10,
  },
  button: { marginTop: 12, padding: 14, backgroundColor: '#173d43', borderRadius: 6 },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center', fontSize: 14 },
  tabBar: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  tabItem: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#214952' },
  tabActive: { backgroundColor: '#d5edb6' },
  tabText: { color: '#cee4b7', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#163b43' },
  footer: { fontSize: 11, color: '#aac6ba', marginTop: 30, textAlign: 'center' },
});
