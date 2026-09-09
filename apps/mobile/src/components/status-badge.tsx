import { View, Text, StyleSheet } from 'react-native';
import { STATUS_BADGE, type InvoiceStatus } from '../lib/tokens';

// Always color + label together, never color alone (design-system.md) —
// same rule enforced identically on web and mobile.
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const config = STATUS_BADGE[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.dot, { backgroundColor: config.dot }]} />
      <Text style={[styles.label, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: '600' },
});
