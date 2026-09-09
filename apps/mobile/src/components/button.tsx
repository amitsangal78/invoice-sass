import { Pressable, Text, StyleSheet, type PressableProps, ActivityIndicator } from 'react-native';
import { colors } from '../lib/tokens';

interface Props extends PressableProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
}

export function Button({ label, variant = 'primary', loading, disabled, style, ...props }: Props) {
  const variantStyle = variant === 'primary' ? styles.primary : variant === 'danger' ? styles.danger : styles.secondary;
  const textStyle = variant === 'secondary' ? styles.secondaryText : styles.primaryText;

  return (
    <Pressable
      style={(state) => [styles.base, variantStyle, (disabled || loading) && styles.disabled, typeof style === 'function' ? style(state) : style]}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' ? colors.textSecondary : '#fff'} /> : <Text style={textStyle}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  secondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
});
