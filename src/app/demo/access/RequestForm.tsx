'use client';

import { useRef, useState, type FormEvent } from 'react';

const fieldClass = 'mt-2 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-text focus:outline-none focus:ring-2 focus:ring-teal';

export default function RequestForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef({ payload: '', id: '' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const email = String(form.get('email')).trim();
    const message = String(form.get('message')).trim();
    const payload = JSON.stringify({ name, email, message });
    if (attempt.current.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    setPending(true);
    setError('');
    try {
      const result = await fetch('/api/product-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, requestId: attempt.current.id }),
      });
      const data = await result.json();
      if (result.ok && data.success) setSent(true);
      else setError(data.error || 'Please check your details and try again.');
    } catch {
      setError('We couldn’t confirm receipt. Please try again here.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <h2 className="font-heading text-2xl font-semibold">Request access</h2>
      {sent ? <p className="mt-4 text-teal" role="status">Request submitted. Our team will review it and reply by email.</p> :
        <form onSubmit={submit} onChange={() => setError('')} className="mt-5 space-y-4 text-sm">
          <label className="block">Name<input className={fieldClass} name="name" autoComplete="name" maxLength={100} required /></label>
          <label className="block">Email<input className={fieldClass} name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label className="block">Short message<textarea className={fieldClass} name="message" rows={3} maxLength={500} placeholder="What would you like to try?" required /></label>
          <p className="text-xs text-muted">Cynchor will use these details to review your request and reply by email.</p>
          {error && <p role="alert" className="text-text">{error}</p>}
          <button disabled={pending} className="w-full rounded-xl bg-teal px-5 py-3 font-semibold text-bg disabled:opacity-60">
            {pending ? 'Sending…' : 'Send access request'}
          </button>
        </form>
      }
    </section>
  );
}
