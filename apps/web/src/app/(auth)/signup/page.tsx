import Link from 'next/link';
import { SignupForm } from '@/features/auth';

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-bold text-text-primary">Create your account</h1>
      <p className="mb-6 text-sm text-text-secondary">No credit card required.</p>
      <SignupForm />
      <p className="mt-6 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary">
          Log in
        </Link>
      </p>
    </main>
  );
}
