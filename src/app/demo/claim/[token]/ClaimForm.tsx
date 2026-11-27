'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/common/Badge';
import { Key, UserCheck, Lock, ArrowRight, AlertCircle } from 'lucide-react';

interface ClaimFormProps {
  token: string;
  initialUsername: string;
  purpose: 'CLAIM' | 'RESET';
}

export function ClaimForm({ token, initialUsername, purpose }: ClaimFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isReset = purpose === 'RESET';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          username: isReset ? undefined : username,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not complete account setup.');
        setIsLoading(false);
        return;
      }

      router.push(data.redirectTo || '/demo/profile');
      router.refresh();
    } catch {
      setError('Network error. Try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-surface p-8 rounded-2xl border border-border shadow-2xl text-text">
      <div className="flex items-center justify-between mb-6">
        <Badge type="v1" />
        <span className="text-[10px] font-mono text-teal bg-teal/10 px-2.5 py-1 rounded border border-teal/30">
          {isReset ? 'PASSWORD-RESET' : 'ZERO-PII CLAIM'}
        </span>
      </div>

      <div className="mb-6 space-y-1">
        <h1 className="font-heading font-bold text-2xl text-text tracking-tightest">
          {isReset ? 'Reset your password' : 'Set up your account'}
        </h1>
        <p className="text-xs text-muted leading-relaxed">
          {isReset
            ? 'Set a new password for your existing callsign. No email required.'
            : 'Confirm your handle and choose a password. No name or email is ever stored.'}
        </p>
      </div>

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
            <UserCheck className="w-4 h-4 absolute left-3.5 top-3 text-muted" />
            <input
              type="text"
              required
              readOnly={isReset}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="cobalt_falcon"
              pattern="[a-z0-9_-]{3,20}"
              title="3-20 lowercase letters, numbers, hyphens, or underscores"
              className={`w-full text-xs font-mono pl-10 pr-3 py-2.5 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal ${
                isReset ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            />
          </div>
          {!isReset && (
            <p className="text-[10px] text-muted mt-1 font-mono">
              3–20 chars: lowercase letters, numbers, hyphens, or underscores.
            </p>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1.5">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 absolute left-3.5 top-3 text-muted" />
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full text-xs pl-10 pr-3 py-2.5 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1.5">
            Confirm Password
          </label>
          <div className="relative">
            <Key className="w-4 h-4 absolute left-3.5 top-3 text-muted" />
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full text-xs pl-10 pr-3 py-2.5 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-teal mt-2 disabled:opacity-50"
        >
          {isLoading ? (
            'Activating...'
          ) : (
            <>
              {isReset ? 'Reset Password & Sign In' : 'Claim Account & Enter'} <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
