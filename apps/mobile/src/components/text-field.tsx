import { View, Text, TextInput, type TextInputProps, StyleSheet } from 'react-native';
import { colors } from '../lib/tokens';

export function TextField({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textMuted} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
