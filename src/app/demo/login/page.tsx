import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser().catch(() => {
    console.error('Could not check the session on the player sign-in page.');
    return null;
  });
  if (user) redirect(user.is_profile_completed ? '/demo/dashboard' : '/demo/profile');

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 bg-bg">
      <Suspense fallback={<div className="text-xs text-muted">Loading gateway...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
