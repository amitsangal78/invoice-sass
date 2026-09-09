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
}

export default function SignupScreen() {
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useAuthStore((s) => s.setWorkspaceId);

  async function handleSignup() {
    setError(null);
    setIsPending(true);
    try {
      const signupResult = await apiFetch<{ workspaceId: string }>('/auth/signup', { method: 'POST', body: { email, password, workspaceName } });
      const loginResult = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
      await setSession(loginResult.accessToken, loginResult.refreshToken);
      await setWorkspaceId(signupResult.workspaceId);
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
        <Text style={styles.title}>Create your account</Text>
        <View style={styles.form}>
          <TextField label="Business name" value={workspaceName} onChangeText={setWorkspaceName} />
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={isPending ? 'Creating account…' : 'Create account'} onPress={handleSignup} loading={isPending} />
        </View>
        <Link href="/login" style={styles.link}>
          Already have an account? Log in
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  form: { gap: 14 },
  error: { color: colors.danger, fontSize: 13 },
  link: { textAlign: 'center', color: colors.primary, fontWeight: '600', fontSize: 14 },
});
