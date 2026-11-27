import { redirect } from 'next/navigation';

interface InvitePageProps {
  params: {
    token: string;
  };
}

export default function InvitePage({ params }: InvitePageProps) {
  redirect(`/demo/claim/${encodeURIComponent(params.token)}`);
}
