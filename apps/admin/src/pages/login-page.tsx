import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; platformRole: string };
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const result = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });

      // The admin console only accepts platform staff — a NORMAL_USER
      // logging in here (even with valid tenant credentials) is rejected
      // client-side too, though the real enforcement is server-side
      // (requirePlatformRole on every /admin/* route).
      if (result.user.platformRole !== 'SUPER_ADMIN' && result.user.platformRole !== 'SUPPORT_ADMIN') {
        setError('This account does not have platform admin access.');
        return;
      }

      setSession(result.accessToken, { id: result.user.id, email: result.user.email, platformRole: result.user.platformRole });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-bold text-text-primary">Billify Admin</h1>
      <p className="mb-6 text-sm text-text-secondary">Platform staff only.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </main>
  );
}
