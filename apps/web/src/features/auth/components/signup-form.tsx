'use client';

import { useActionState } from 'react';
import { signupAction } from '../api/actions';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signupAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="workspaceName">Business name</Label>
        <Input id="workspaceName" name="workspaceName" required placeholder="Acme Consulting" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Creating your account…' : 'Create account'}
      </Button>
    </form>
  );
}
