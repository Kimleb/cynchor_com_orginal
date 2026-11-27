'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (response.ok) setSubmitted(true);
      else setError((await response.json()).error || 'Try again in a moment.');
    } catch {
      setError('Unable to send your request. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <section className="space-y-5 rounded-2xl border border-border bg-surface p-7 text-sm">
        <h1 className="font-heading text-2xl font-semibold">Forgot your password?</h1>
        {submitted ? (
          <p role="status" className="text-teal">
            If this username matches an account, the operator will see your request. Contact the person who issued your credentials so they can verify your identity and share a reset link.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-muted">Enter your demo username to request a one-time reset link from your operator.</p>
            <label className="block">
              Username
              <input required autoComplete="username" maxLength={20} value={username}
                onChange={event => setUsername(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-text" />
            </label>
            {error && <p role="alert">{error}</p>}
            <button disabled={pending} className="w-full rounded-xl bg-teal py-2.5 font-semibold text-bg disabled:opacity-60">
              {pending ? 'Submitting…' : 'Request password reset'}
            </button>
          </form>
        )}
        <Link href="/demo/login" className="inline-block text-teal underline">Back to sign in</Link>
      </section>
    </main>
  );
}
