import Link from 'next/link';
import { Crosshair, Shield, Trophy } from 'lucide-react';

const cards = [
  { href: '/range/lobby', title: 'Join a queue', body: 'Queue your squad for a live Red vs Blue match against the Fintech target.', Icon: Crosshair },
  { href: '/range/leaderboard', title: 'Leaderboard', body: 'Team and player standings across all finished range matches.', Icon: Trophy },
  { href: '/demo/team', title: 'Squad setup', body: 'Create or join the squad you will queue with.', Icon: Shield },
];

export default function RangeHomePage() {
  return (
    <div className="min-h-[70vh] bg-bg text-text py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-heading font-bold text-2xl">Fintech Range</h1>
          <p className="text-xs text-muted mt-1">Live Red vs Blue matches against an intentionally vulnerable bank running in an isolated container.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {cards.map(({ href, title, body, Icon }) => (
            <Link key={href} href={href} className="p-5 rounded-2xl bg-surface border border-border hover:border-teal space-y-2 block">
              <Icon className="w-5 h-5 text-teal" />
              <div className="font-heading font-semibold text-sm">{title}</div>
              <p className="text-xs text-muted">{body}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
