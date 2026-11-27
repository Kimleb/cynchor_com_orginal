import { redirect } from 'next/navigation';

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  redirect(`/demo/claim/${encodeURIComponent((await params).token)}`);
}
