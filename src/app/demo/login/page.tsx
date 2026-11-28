import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { demoTeamPath } from '@/lib/demo-team';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const user = await getCurrentUser().catch(() => {
    console.error('Could not check the session on the player sign-in page.');
    return null;
  });
  if (user) {
    const teamPath = demoTeamPath((await searchParams).invite);
    const query = teamPath.split('?')[1];
    redirect(user.is_profile_completed ? (query ? teamPath : '/demo/dashboard')
      : query ? '/demo/profile?' + query : '/demo/profile');
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 bg-bg">
      <Suspense fallback={<div className="text-xs text-muted">Loading gateway...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
