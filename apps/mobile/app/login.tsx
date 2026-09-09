import { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Link, router } from 'expo-router';
import { apiFetch, ApiClientError } from '../src/lib/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { TextField } from '../src/components/text-field';
import { Button } from '../src/components/button';
import { colors } from '../src/lib/tokens';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

interface WorkspaceMembership {
  workspaceId: string;
  name: string;
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useAuthStore((s) => s.setWorkspaceId);

  async function handleLogin() {
    setError(null);
    setIsPending(true);
    try {
      const result = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
      await setSession(result.accessToken, result.refreshToken);

      // Simplification, stated plainly: auto-select the first workspace
      // rather than a full switcher screen — see requirements/mobile.md's
      // scope notes. A real multi-workspace switcher is a follow-up.
      const workspaces = await apiFetch<WorkspaceMembership[]>('/workspaces/mine');
      if (workspaces.length === 0) {
        setError('This account has no workspace.');
        return;
      }
      await setWorkspaceId(workspaces[0]!.workspaceId);

      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Billify</Text>
        <Text style={styles.subtitle}>Log in to your account</Text>

        <View style={styles.form}>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="email-input" />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry testID="password-input" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={isPending ? 'Logging in…' : 'Log in'} onPress={handleLogin} loading={isPending} testID="login-button" />
        </View>

        <Link href="/signup" style={styles.link}>
          No account yet? Sign up
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: -12 },
  form: { gap: 14 },
  error: { color: colors.danger, fontSize: 13 },
  link: { textAlign: 'center', color: colors.primary, fontWeight: '600', fontSize: 14 },
});
