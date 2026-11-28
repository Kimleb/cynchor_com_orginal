'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { TEAM_SIZE, RULES_VERSION, demoTeamPath } from '@/lib/demo-team';

type Side = 'RED' | 'BLUE';
type RecruitingTeam = { id: string; name: string; side: Side; member_count: number };
type Team = Omit<RecruitingTeam, 'member_count'> & {
  status: string;
  roster: { id: string; member_id: string; username: string; accepted_at: string | null }[];
};
type TeamData = { myTeam: Team | null; availableTeams: RecruitingTeam[] };
type Action = 'CREATE' | 'JOIN' | 'AUTO_MATCH' | 'LEAVE' | 'ACCEPT_RULES';

const card = 'space-y-4 rounded-2xl border border-border bg-surface p-5 sm:p-6';
const field = 'w-full rounded-xl border border-border bg-surface-2 p-2.5 text-sm text-text';
const button = 'rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-teal disabled:opacity-50';

export default function TeamRoster({ invite, memberId, lobby }: { invite?: string; memberId?: string; lobby?: string }) {
  const router = useRouter();
  const [data, setData] = useState<TeamData>();
  const [side, setSide] = useState<Side>('RED');
  const [teamId, setTeamId] = useState(invite ?? '');
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/teams', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load teams.');
    const next = await response.json();
    if (next.myTeam && !memberId) router.replace('/demo/fintech');
    else if (!next.myTeam && memberId) router.replace('/demo/dashboard');
    else setData(next);
  }, [memberId, router]);

  useEffect(() => {
    refresh().catch(() => setError('Could not load teams.'));
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function update(action: Action, id?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamId: id, teamName, side, memberId, version: RULES_VERSION }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) setError(result.error || 'Could not update your team.');
      else {
        setInviteUrl('');
        if (action === 'LEAVE') router.replace('/demo/dashboard');
        else if (action === 'ACCEPT_RULES') await refresh();
        else router.replace('/demo/fintech');
      }
    } catch {
      setError('Could not update your team. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function share(id: string) {
    const url = new URL(demoTeamPath(id), window.location.origin).href;
    setInviteUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Invite link copied.');
    } catch {
      setNotice('Select and copy the invite link below.');
    }
  }

  const team = data?.myTeam;
  const full = team?.roster.length === TEAM_SIZE;
  const accepted = team?.roster.find(player => player.member_id === memberId)?.accepted_at;
  const ready = full && team.roster.every(player => player.accepted_at);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-5 py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold">{memberId ? 'Live Fintech PvP' : 'Create or join a team'}</h1>
          <p className="mt-2 text-sm text-muted">{memberId ? 'Team room' : 'Form a team of up to three players.'}</p>
        </div>
        <form action="/api/auth/logout" method="post"><button className={button}>Log out</button></form>
      </header>

      {error && <p role="alert" className="rounded-xl border border-coral/40 p-3 text-sm">{error}</p>}
      {!data && !error && <p role="status" className="text-sm text-muted">Loading teams…</p>}
      {team && (
        <section className={card}>
          <h2 className="font-heading text-xl font-semibold">{team.name}</h2>
          <p className="text-sm text-muted">{team.side === 'RED' ? 'Red' : 'Blue'} team · {team.roster.length}/{TEAM_SIZE} players</p>
          <p className="break-all text-sm">Team ID <code className="text-teal">{team.id}</code></p>
          <ul className="space-y-2">
            {team.roster.map(player => <li key={player.id} className="rounded-xl border border-border p-3 text-sm">@{player.username}<span className="block break-all text-xs text-muted">Member ID {player.member_id} · {player.accepted_at ? 'Rules accepted' : 'Awaiting acceptance'}</span></li>)}
          </ul>
          {!accepted && <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="font-heading font-semibold">Rules of engagement</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Use only the systems assigned to your team for this exercise.</li>
              <li>Keep credentials and exercise data inside the range.</li>
              <li>Stop when the session ends and report unexpected access to the operator.</li>
            </ul>
            <button className={button} disabled={busy} onClick={() => void update('ACCEPT_RULES')}>I accept the rules of engagement</button>
          </section>}
          {team.status === 'RECRUITING' && team.roster.length < TEAM_SIZE && (
            <p className="text-sm text-muted">Invite a teammate or keep the roster open while others look for a team.</p>
          )}
          {team.roster.length > TEAM_SIZE && <p className="text-sm text-muted">This older roster needs to return to three players before it can enter the range.</p>}
          <div className="flex flex-wrap gap-2">
            {team.status === 'RECRUITING' && team.roster.length < TEAM_SIZE && <button type="button" className={button} onClick={() => void share(team.id)}>Copy invite link</button>}
            {team.status !== 'MATCHED' && <button type="button" className={button} disabled={busy} onClick={() => void update('LEAVE')}>Leave team</button>}
            {ready && <Link className={button} href="/demo/ranges">Range progress</Link>}
            {ready && lobby && <Link className="rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-bg" href={lobby}>Fintech PvP lobby</Link>}
            {ready && !lobby && <p className="self-center text-sm text-muted">The live range is unavailable on this deployment.</p>}
          </div>
          {notice && <p role="status" className="text-sm text-teal">{notice}</p>}
          {inviteUrl && <input aria-label="Team invite link" readOnly value={inviteUrl} className={field} onFocus={event => event.target.select()} />}
        </section>
      )}
      {data && !team && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className={card}>
              <h2 className="font-heading text-lg font-semibold">Create or find a team</h2>
              <label className="block text-sm">Side
                <select className={field} value={side} onChange={event => setSide(event.target.value === 'BLUE' ? 'BLUE' : 'RED')}>
                  <option value="RED">Red</option><option value="BLUE">Blue</option>
                </select>
              </label>
              <form className="space-y-3" onSubmit={event => { event.preventDefault(); void update('CREATE'); }}>
                <label className="block text-sm">Team name <span className="text-muted">(optional)</span>
                  <input className={field} maxLength={40} value={teamName} onChange={event => setTeamName(event.target.value)} />
                </label>
                <button className="rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50" disabled={busy}>Create team</button>
              </form>
              <button type="button" className={button} disabled={busy} onClick={() => void update('AUTO_MATCH')}>Find teammates</button>
              <p className="text-sm text-muted">If no team has room, you’ll get a recruiting team that other players can join.</p>
            </section>
            <section className={card}>
              <h2 className="font-heading text-lg font-semibold">{invite ? 'Join from invite' : 'Join with a team ID'}</h2>
              <form className="space-y-3" onSubmit={event => { event.preventDefault(); void update('JOIN', teamId); }}>
                <label className="block text-sm">Team ID
                  <input required className={field} value={teamId} onChange={event => setTeamId(event.target.value)} />
                </label>
                <button className={button} disabled={busy}>Join team</button>
              </form>
            </section>
          </div>
          <section className={card}>
            <h2 className="font-heading text-lg font-semibold">Open teams</h2>
            {data.availableTeams.length === 0 && <p className="text-sm text-muted">No teams have open slots right now.</p>}
            <ul className="space-y-2">
              {data.availableTeams.map(row => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                  <span><strong>{row.name}</strong> · {row.side} · {row.member_count}/{TEAM_SIZE}</span>
                  <button className={button} type="button" disabled={busy} onClick={() => void update('JOIN', row.id)}>Join</button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
