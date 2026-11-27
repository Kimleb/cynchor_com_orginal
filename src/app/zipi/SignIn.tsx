'use client';

import { useState, type FormEvent } from 'react';

export default function SignIn() {
  const [step, setStep] = useState<'start' | 'verify'>('start');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/zipi/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(step === 'start' ? { step, email, code } : { step, code }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error || 'Unable to sign in.');
      else if (step === 'verify') window.location.replace('/zipi');
      else {
        setStep('verify');
        setCode('');
      }
    } catch {
      setError('Unable to reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const field = 'mt-2 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-text';
  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-surface p-7 text-sm">
        <h1 className="font-heading text-2xl font-semibold">Operator sign-in</h1>
        <p className="text-muted">{step === 'start' ? 'Use the current Google Authenticator code for your enrolled work email.' : `Enter the code sent to ${email}. It expires in 10 minutes.`}</p>
        <label className="block">{step === 'start' ? 'Google Authenticator code' : 'Email verification code'}
          <input key={step} className={field} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            value={code} onChange={event => setCode(event.target.value)} required />
        </label>
        {step === 'start' && <label className="block">Cynchor email
          <input className={field} type="email" autoComplete="email" value={email} placeholder="you@cynchor.com"
            onChange={event => setEmail(event.target.value)} required />
        </label>}
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-teal py-2.5 font-semibold text-bg disabled:opacity-60">
          {busy ? 'Verifying…' : step === 'start' ? 'Verify and email me a code' : 'Sign in'}
        </button>
        {step === 'verify' && <button type="button" disabled={busy} className="text-teal" onClick={() => { setStep('start'); setCode(''); setError(''); }}>Start again</button>}
      </form>
    </main>
  );
}
