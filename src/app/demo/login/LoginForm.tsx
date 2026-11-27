'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/common/Badge';
import { Lock, User, ArrowRight, AlertCircle, Key } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const paramUsername = searchParams.get('username');
    const paramToken = searchParams.get('inviteToken');
    if (paramUsername) setUsername(paramUsername);
    if (paramToken) setInviteToken(paramToken);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, inviteToken }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid username or password.');
        setIsLoading(false);
        return;
      }

      router.push(data.redirectTo);
      router.refresh();
    } catch {
      setError('Authentication error. Try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-surface p-8 rounded-2xl border border-border shadow-2xl text-text">
      <div className="flex items-center justify-between mb-6">
        <Badge type="v1" />
        <span className="text-[10px] font-mono text-muted bg-surface-2 px-2.5 py-1 rounded border border-border">
          AUTH-GATE-v1.9
        </span>
      </div>

      <div className="mb-6 space-y-1">
        <h1 className="font-heading font-bold text-2xl text-text tracking-tightest">
          Portal Login
        </h1>
        <p className="text-xs text-muted leading-relaxed">
          Sign in with the username and password your operator gave you.
        </p>
      </div>

      {inviteToken && (
        <div className="mb-5 p-3 rounded-xl bg-teal/10 border border-teal/30 text-teal text-xs flex items-center gap-2 font-mono">
          <Key className="w-4 h-4 text-teal shrink-0" />
          <span>Claim token: <strong>{inviteToken}</strong></span>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 rounded-xl bg-coral/10 border border-coral/30 text-coral text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-coral shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1.5">
            Username (Callsign)
          </label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3.5 top-3 text-muted" />
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
              placeholder="Your username"
              className="w-full text-xs font-mono pl-10 pr-3 py-2.5 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1.5">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3.5 top-3 text-muted" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full text-xs pl-10 pr-3 py-2.5 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-teal mt-2"
        >
          {isLoading ? (
            'Authenticating...'
          ) : (
            <>
              Sign In <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <Link href="/demo/forgot-password" className="mt-4 inline-block text-sm text-teal underline">Forgot password?</Link>

      <p className="mt-6 border-t border-border pt-5 text-sm text-muted">
        Need credentials? <Link href="/demo/access" className="text-teal underline">Request access</Link>
      </p>
    </div>
  );
}
