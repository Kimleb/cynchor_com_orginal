import React from 'react';
import Link from 'next/link';
import { inspectClaimToken } from '@/lib/db';
import { Badge } from '@/components/common/Badge';
import { XCircle, ArrowRight } from 'lucide-react';
import { ClaimForm } from './ClaimForm';

export const dynamic = 'force-dynamic';

interface ClaimPageProps {
  params: Promise<{ token: string }>;
}

export default async function ClaimPage({ params }: ClaimPageProps) {
  const { token } = await params;
  const check = await inspectClaimToken(token);

  if (check.valid) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 bg-bg text-text">
        <ClaimForm
          token={token}
          initialUsername={check.username || ''}
          purpose={check.purpose || 'CLAIM'}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 bg-bg text-text">
      <div className="w-full max-w-md bg-surface p-8 rounded-2xl border border-border shadow-xl text-center space-y-4">
        <div className="flex justify-center">
          <Badge type="v1" />
        </div>

        <div className="w-12 h-12 rounded-full bg-coral/10 text-coral flex items-center justify-center mx-auto">
          <XCircle className="w-6 h-6" />
        </div>

        <div>
          <h1 className="font-heading font-bold text-xl text-text">Invalid or Expired Claim Link</h1>
          <p className="text-xs text-muted mt-1">{check.error || 'Claim token not found.'}</p>
        </div>

        <div className="space-y-2 pt-2">
          <Link
            href="/demo/login"
            className="w-full py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal transition-all inline-flex items-center justify-center gap-2"
          >
            Go to Portal Login <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href="/"
            className="w-full py-2.5 px-4 rounded-xl border border-border text-muted hover:text-text hover:bg-surface-2 text-xs font-heading font-medium transition-colors inline-block"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
