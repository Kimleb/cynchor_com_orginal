'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { IncidentView } from '@/lib/incident-game';
const searchTips = [
  'Use a unique password for each account.',
  'Verify payment changes with a call to a known number.',
  'Lock your screen when you step away.',
  'Report sign-in prompts you didn’t request.',
  'Check the domain before entering your password.',
  'Keep recovery codes somewhere secure.',
];

function SearchTip() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * searchTips.length));
  useEffect(() => {
    const interval = setInterval(() => {
      const offset = 1 + Math.floor(Math.random() * (searchTips.length - 1));
      setIndex(previous => (previous + offset) % searchTips.length);
    }, 7000);
    return () => clearInterval(interval);
  }, []);
  return <p className="mx-auto max-w-sm text-sm text-muted"><span className="font-medium text-teal">Security tip</span> · {searchTips[index]}</p>;
}
export default function Round() {
  const [game,setGame] = useState<IncidentView>(), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (action:string,id?:string,choice?:number) => {
    const serial = ++sequence.current;
    try {
      const res = await fetch('/api/incident',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,choice})});
      const data = await res.json();
      if (serial !== sequence.current) return;
      if (!res.ok) throw new Error(data.error);
      setGame(data); setError('');
    } catch(e) { if (serial === sequence.current) setError(e instanceof Error ? e.message : 'Connection interrupted.'); }
  },[]);
  useEffect(() => {
    if (busy) return;
    void load('status');
    if (game?.phase === 'finished') return;
    const t = setInterval(() => void load('status'), 4000);
    return () => clearInterval(t);
  },[load,busy,game?.phase]);
  async function act(action:string,choice?:number) {
    setBusy(true);
    try { await load(action,game?.id,choice); } finally { setBusy(false); }
  }
  const button = 'rounded-xl border border-teal/50 px-4 py-3 text-left text-sm hover:bg-teal/10 disabled:opacity-50';
  return <main className="mx-auto max-w-2xl space-y-5 px-5 py-14">
    <Link href="/demo/fintech" className="text-sm text-teal">← Team room</Link>
    <section className="space-y-5 rounded-2xl border border-border bg-surface p-7">
      <h1 className="font-heading text-3xl font-bold">Fintech incident response</h1>
      {error && <p role="alert">{error}</p>}
      {!game && !error && <p>Loading round…</p>}
      {game?.phase === 'idle' && <><p>Both teams have two minutes to respond to the same incident. Each correct response earns 100 points for your team and unlocks your next level.</p><button className={button} disabled={busy} onClick={()=>act('queue')}>Find opposing team</button></>}
      {(game?.phase === 'waiting' || game?.phase === 'expired') && <div className="space-y-4 py-3 text-center">
        {game.phase === 'waiting' && <div aria-hidden="true" className="relative mx-auto grid h-24 w-24 place-items-center rounded-full bg-teal/5">
          <div className="absolute inset-1 rounded-full border-2 border-teal/15 border-r-teal/60 border-t-teal motion-safe:animate-[spin_2s_linear_infinite]" />
          <ShieldCheck className="h-8 w-8 text-teal" strokeWidth={1.5} />
        </div>}
        <div role="status">
          <h2 className="font-heading text-xl font-semibold">{game.phase === 'waiting' ? 'Searching for an opponent' : 'Search timed out'}</h2>
          {game.phase === 'expired' && <p className="mt-1 text-sm text-muted">No opposing team was available.</p>}
        </div>
        {game.phase === 'waiting' && <SearchTip />}
        {game.phase === 'expired' ? <button className={button} disabled={busy} onClick={()=>act('queue')}>Search again</button> : <button className={button} disabled={busy} onClick={()=>act('cancel')}>Cancel search</button>}
      </div>}
      {(game?.phase === 'playing' || game?.phase === 'finished') && <>
        <h2 className="text-xl font-semibold">Level {game.level} · {game.title}</h2><p>{game.prompt}</p>
        {game.phase === 'playing' ? <>
          <p className="text-sm text-muted">{game.submitted}/6 responses · Ends at {new Date(game.deadline!).toLocaleTimeString()}</p>
          {game.choice === undefined ? <div className="grid gap-2">{game.options?.map((label,i)=><button key={label} className={button} disabled={busy} onClick={()=>act('answer',i)}>{label}</button>)}</div> : <p>Your response is saved. Waiting for the round to finish.</p>}
        </> : <>
          <h3 className="text-xl font-semibold">{game.red === game.blue ? 'Draw' : game.red! > game.blue! ? 'Red team wins' : 'Blue team wins'}</h3>
          <p>Red {game.red} pts · Blue {game.blue} pts</p><p>Preferred response: {game.answer}</p>
          <div className="flex items-center gap-4"><button className={button} disabled={busy} onClick={()=>act('queue')}>Play again</button><Link className="text-teal" href="/demo/ranges">View progress</Link></div>
        </>}
      </>}
    </section>
  </main>;
}
