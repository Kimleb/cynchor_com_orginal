'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/common/Badge';
import {
  Lock,
  Key,
  UserCheck,
  UserPlus,
  CheckCircle2,
  Copy,
  RefreshCw,
  ExternalLink,
  Users,
  Sparkles,
  RotateCcw,
} from 'lucide-react';

interface RequestItem {
  id: string;
  note?: string | null;
  applicant_name?: string;
  reply_email?: string;
  reset_user_id?: string;
  status: string;
  source?: string;
  created_at: string;
  approved_at?: string;
}

interface InviteItem {
  id: string;
  username?: string | null;
  purpose?: string;
  is_used: number;
  expires_at: string;
  created_at: string;
}

interface UserItem {
  id: string;
  username: string;
  role: string;
  experience_level: string;
  is_profile_completed: number;
  is_operator: number;
  created_at: string;
}

const CALLSIGN_ADJECTIVES = ['cobalt', 'silent', 'shadow', 'amber', 'iron', 'cipher', 'crimson', 'obsidian'];
const CALLSIGN_NOUNS = ['falcon', 'viper', 'warden', 'lynx', 'kestrel', 'specter', 'beacon', 'sentinel'];

function suggestCallsign(): string {
  const adj = CALLSIGN_ADJECTIVES[Math.floor(Math.random() * CALLSIGN_ADJECTIVES.length)];
  const noun = CALLSIGN_NOUNS[Math.floor(Math.random() * CALLSIGN_NOUNS.length)];
  const suffix = Math.floor(10 + Math.random() * 89);
  return `${adj}_${noun}_${suffix}`;
}

export default function AdminPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [claimUsername, setClaimUsername] = useState(() => suggestCallsign());
  const [requestUsernames, setRequestUsernames] = useState<Record<string, string>>({});
  const [generatedLink, setGeneratedLink] = useState<{ token: string; url: string; purpose?: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const [provUsername, setProvUsername] = useState('');
  const [provPass, setProvPass] = useState('');
  const [provRole, setProvRole] = useState('RED_TEAM');
  const [provSuccess, setProvSuccess] = useState('');

  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/zipi');
      const data = await res.json();
      if (data.success) {
        const reqs: RequestItem[] = data.requests || [];
        setRequests(reqs);
        setInvites(data.invites || []);
        setUsers(data.users || []);
        setRequestUsernames((prev) => {
          const next = { ...prev };
          for (const r of reqs) {
            if (!next[r.id]) next[r.id] = suggestCallsign();
          }
          return next;
        });
      }
    } catch {
      // Catch error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const buildAbsoluteClaimUrl = (claimPath: string) => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${claimPath}`;
    }
    return claimPath;
  };

  const handleApprove = async (requestId: string) => {
    setActionError('');
    const username = (requestUsernames[requestId] || '').trim().toLowerCase();
    try {
      const res = await fetch('/api/zipi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE_REQUEST', requestId, username }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedLink({ token: data.token, url: data.claimUrl, purpose: 'CLAIM' });
        fetchData();
      } else {
        setActionError(data.error || 'Approval failed.');
      }
    } catch {
      setActionError('Approval failed.');
    }
  };

  const handleGenerateClaimLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/zipi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'GENERATE_INVITE', username: claimUsername }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedLink({ token: data.token, url: data.claimUrl, purpose: 'CLAIM' });
        setClaimUsername(suggestCallsign());
        fetchData();
      } else {
        setActionError(data.error || 'Failed to generate claim link.');
      }
    } catch {
      setActionError('Failed to generate claim link.');
    }
  };

  const handleIssueResetLink = async (userId: string) => {
    setActionError('');
    try {
      const res = await fetch('/api/zipi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ISSUE_RESET_LINK', userId }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedLink({ token: data.token, url: data.claimUrl, purpose: 'RESET' });
        fetchData();
      } else {
        setActionError(data.error || 'Failed to issue reset link.');
      }
    } catch {
      setActionError('Failed to issue reset link.');
    }
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError('');
    setProvSuccess('');
    try {
      const res = await fetch('/api/zipi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PROVISION_USER',
          username: provUsername,
          password: provPass,
          role: provRole,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProvSuccess(`Account for @${data.username} provisioned.`);
        setProvUsername('');
        fetchData();
      } else {
        setActionError(data.error || 'User provisioning failed.');
      }
    } catch {
      setActionError('User provisioning failed.');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedValue(text);
    setTimeout(() => setCopiedValue(null), 2500);
  };

  return (
    <div className="min-h-[90vh] bg-bg text-text py-10 px-4 sm:px-6">
      <div className="container mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface p-6 rounded-2xl border border-border shadow-md">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                <Lock className="w-3.5 h-3.5" /> Operator Console
              </span>

            </div>
            <h1 className="font-heading font-bold text-2xl text-text tracking-tightest">
              Operator Access Governance
            </h1>
            <p className="text-xs text-muted mt-0.5">
              Review access requests, issue claim links, and manage player accounts.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="text-xs text-teal" onClick={async () => {
              try {
                const response = await fetch('/api/zipi/auth', { method: 'DELETE' });
                if (!response.ok) throw new Error();
                window.location.replace('/zipi');
              } catch {
                setActionError('Unable to sign out. Try again.');
              }
            }}>Sign out</button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="py-1.5 px-3 text-xs font-heading font-medium border border-border rounded-xl bg-surface-2 hover:bg-surface text-text flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href="/demo/login"
              className="py-1.5 px-3 text-xs font-heading font-semibold rounded-xl bg-teal text-bg hover:shadow-glow-teal transition-all"
            >
              Test Login
            </Link>
          </div>
        </div>

        {actionError && (
          <div className="p-3 rounded-xl bg-coral/10 border border-coral/30 text-coral text-xs">
            {actionError}
          </div>
        )}

        {/* Highlight Banner if Claim/Reset Link was created */}
        {generatedLink && (
          <div className="p-4 rounded-xl bg-teal/10 border border-teal/30 text-teal flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Key className="w-5 h-5 text-teal shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal">
                  {generatedLink.purpose === 'RESET'
                    ? 'One-Time Password Reset Link (Shown Once):'
                    : 'One-Time Claim Link Generated (Shown Once):'}
                </span>
                <div className="font-mono font-bold text-sm text-text break-all">
                  {buildAbsoluteClaimUrl(generatedLink.url)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyToClipboard(buildAbsoluteClaimUrl(generatedLink.url))}
                className="py-1.5 px-3 rounded-lg bg-surface border border-teal/40 text-teal text-xs font-medium hover:bg-surface-2 flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedValue === buildAbsoluteClaimUrl(generatedLink.url) ? 'Copied' : 'Copy Link'}
              </button>
              <Link
                href={generatedLink.url}
                target="_blank"
                className="py-1.5 px-3 rounded-lg bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal flex items-center gap-1"
              >
                Open <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Column 1: Action Panels */}
          <div className="space-y-6">
            {/* Panel A: Generate One-Time Claim Link */}
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-teal" />
                <h3 className="font-heading font-bold text-sm text-text">
                  Issue One-Time Claim Link
                </h3>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Creates an expiring single-use link (/demo/claim/&#123;token&#125;) for out-of-band delivery. No email required.
              </p>

              <form onSubmit={handleGenerateClaimLink} className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel">
                      Assigned Username
                    </label>
                    <button
                      type="button"
                      onClick={() => setClaimUsername(suggestCallsign())}
                      className="text-[10px] font-mono text-teal hover:underline inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" /> Suggest
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={claimUsername}
                    onChange={(e) => setClaimUsername(e.target.value.toLowerCase())}
                    placeholder="cobalt_falcon_42"
                    pattern="[a-z0-9_-]{3,20}"
                    className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-teal"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 px-3 rounded-xl bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal transition-all flex items-center justify-center gap-1.5"
                >
                  Generate Claim Link
                </button>
              </form>
            </div>

            {/* Panel B: Provision Account Manually */}
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-purple-400" />
                <h3 className="font-heading font-bold text-sm text-text">
                  Provision User (No Self-Registration)
                </h3>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Directly seeds an authorized username with pre-hashed credentials.
              </p>

              {provSuccess && (
                <div className="p-2.5 rounded-xl bg-teal/10 border border-teal/30 text-teal text-xs">
                  {provSuccess}
                </div>
              )}

              <form onSubmit={handleProvisionUser} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={provUsername}
                    onChange={(e) => setProvUsername(e.target.value.toLowerCase())}
                    placeholder="shadow_warden"
                    pattern="[a-z0-9_-]{3,20}"
                    className="w-full text-xs font-mono px-3 py-2 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1">
                    Temporary Password (min 12 chars)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={12}
                    value={provPass}
                    onChange={(e) => setProvPass(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-heading font-semibold text-muted uppercase tracking-widestlabel mb-1">
                    Default Role
                  </label>
                  <select
                    value={provRole}
                    onChange={(e) => setProvRole(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-surface-2 text-text focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="RED_TEAM">Red Team</option>
                    <option value="BLUE_TEAM">Blue Team</option>
                    <option value="NET_SEC">Network Security</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full py-2 px-3 rounded-xl border border-border text-text hover:bg-surface-2 text-xs font-heading font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  Provision User Now
                </button>
              </form>
            </div>
          </div>

          {/* Column 2 & 3: Pending Requests, Claim Links, Users */}
          <div className="lg:col-span-2 space-y-6">
            {/* Pending Claim Requests */}
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-teal" />
                  <h3 className="font-heading font-bold text-sm text-text">
                    Pending Claim Requests
                  </h3>
                </div>
                <span className="text-xs font-mono text-muted">
                  {requests.filter((r) => r.status === 'PENDING').length} Pending
                </span>
              </div>

              {requests.length === 0 ? (
                <p className="text-xs text-muted py-4 text-center">
                  No requests submitted yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {requests.map((req) => (
                    <div
                      key={req.id}
                      className="p-3 rounded-xl border border-border bg-surface-2 flex flex-col gap-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-text font-medium truncate">
                            {req.note || 'No note provided'}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase border shrink-0 ${
                              req.source === 'pilot'
                                ? 'bg-coral/15 text-coral border-coral/30'
                                : 'bg-teal/15 text-teal border-teal/30'
                            }`}
                          >
                            {req.reset_user_id ? 'Password reset' : req.source || 'demo'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-muted shrink-0">
                          {new Date(req.created_at).toLocaleString()}
                        </span>
                      </div>

                      {req.reply_email && <p className="break-words text-text">{req.applicant_name} · {req.reply_email}</p>}
                      {req.status === 'PENDING' && req.reset_user_id ? (
                        <div className="space-y-2">
                          <p className="text-muted">Verify the player’s identity before sharing a reset link.</p>
                          <button type="button" onClick={() => handleIssueResetLink(req.reset_user_id!)}
                            className="rounded-lg bg-teal px-3 py-1.5 font-semibold text-bg">
                            Issue reset link
                          </button>
                        </div>
                      ) : req.status === 'PENDING' ? (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            type="text"
                            value={requestUsernames[req.id] || ''}
                            onChange={(e) =>
                              setRequestUsernames((prev) => ({
                                ...prev,
                                [req.id]: e.target.value.toLowerCase(),
                              }))
                            }
                            placeholder="assign_username"
                            className="flex-1 text-xs font-mono px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text focus:outline-none focus:ring-1 focus:ring-teal"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setRequestUsernames((prev) => ({
                                ...prev,
                                [req.id]: suggestCallsign(),
                              }))
                            }
                            className="py-1.5 px-2.5 rounded-lg border border-border text-muted hover:text-text text-[11px] font-mono"
                          >
                            Suggest
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApprove(req.id)}
                            className="py-1.5 px-3 rounded-lg bg-teal text-bg font-heading font-semibold text-xs hover:shadow-glow-teal flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve &amp; Issue Link
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-teal/15 text-teal border border-teal/30">
                            Approved
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generated Claim Links */}
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-teal" />
                  <h3 className="font-heading font-bold text-sm text-text">
                    Generated Claim &amp; Reset Tokens
                  </h3>
                </div>
                <span className="text-xs font-mono text-muted">{invites.length} Total</span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-3 rounded-xl border border-border bg-surface-2 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-text">{inv.id.slice(0, 12)}…</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border bg-surface text-muted">
                          {inv.purpose || 'CLAIM'}
                        </span>
                        {inv.is_used ? (
                          <span className="text-[9px] text-muted bg-surface px-1.5 py-0.2 rounded border border-border">
                            Redeemed
                          </span>
                        ) : (
                          <span className="text-[9px] text-teal bg-teal/15 px-1.5 py-0.2 rounded border border-teal/30">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted font-mono">
                        @{inv.username || 'unassigned'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Provisioned Users Directory */}
            <div className="bg-surface p-6 rounded-2xl border border-border shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-text" />
                  <h3 className="font-heading font-bold text-sm text-text">
                    Directory Users
                  </h3>
                </div>
                <span className="text-xs font-mono text-muted">{users.length} Users</span>
              </div>

              <p className="text-[11px] text-muted bg-surface-2 px-3 py-2 rounded-xl border border-border">
                Verify the player’s identity before sharing a one-time password reset link.
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 rounded-xl border border-border bg-surface-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-mono font-semibold text-text flex items-center gap-2">
                        <span>@{u.username}</span>
                        {u.is_operator === 1 && <Badge type="operator" size="sm" />}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {u.role === 'RED_TEAM' && <Badge type="red" size="sm" />}
                      {u.role === 'BLUE_TEAM' && <Badge type="blue" size="sm" />}
                      {u.role === 'NET_SEC' && <Badge type="netsec" size="sm" />}
                      {!u.role && (
                        <span className="text-[10px] text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-border">
                          New (Profile Pending)
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleIssueResetLink(u.id)}
                        className="py-1 px-2.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-[11px] font-medium text-text inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3 text-teal" /> Issue reset link
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
