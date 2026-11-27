import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import RequestForm from './RequestForm';

export default async function ProductAccess() {
  const user = await getCurrentUser();
  if (user) redirect(user.is_profile_completed ? '/demo/dashboard' : '/demo/profile');

  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-6 py-14 md:grid-cols-2 md:gap-16 md:py-24">
      <section className="self-start md:pt-8">
        <h1 className="font-heading text-4xl font-bold tracking-tight">Inside the Cynchor range</h1>
        <p className="mt-5 leading-relaxed text-muted">
          Cynchor is a hands-on cybersecurity training environment. Work solo or with a squad,
          practice attack and defense in simulated scenarios, and review your team’s results.
        </p>
        <p className="mt-4 leading-relaxed text-muted">
          Tell us what you’d like to try. Our team reviews each request and emails sign-in details to approved applicants.
        </p>
        <div className="mt-8 border-t border-border pt-5">
          Already have credentials? <Link href="/demo/login" className="font-semibold text-teal underline">Sign in</Link>
        </div>
      </section>
      <RequestForm />
    </main>
  );
}
