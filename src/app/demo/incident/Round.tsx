'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { TimerOff } from 'lucide-react';
import Link from 'next/link';
import type { IncidentView } from '@/lib/incident-game';
function SearchDial({deadline}: {deadline?: string}) {
  const [now,setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [deadline]);
  const seconds = Math.min(120, Math.max(0, Math.ceil((Date.parse(deadline ?? '') - now) / 1000)));
  return <div className="relative mx-auto grid h-36 w-36 place-items-center rounded-full border border-teal/20 bg-teal/5">
    {deadline ? <>
      <div aria-hidden="true" className="absolute inset-2 rounded-full" style={{background:`conic-gradient(#16b4b2 ${seconds * 3}deg, transparent 0)`, maskImage:'radial-gradient(circle, transparent 65%, black 66%)'}} />
      <div aria-hidden="true" className="absolute inset-5 rounded-full border border-dashed border-teal/40 motion-safe:animate-[spin_16s_linear_infinite]" />
      <span role="timer" aria-label="Search time remaining" className="font-mono text-3xl tabular-nums text-teal">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>
    </> : <TimerOff aria-hidden="true" className="h-10 w-10 text-muted" />}
  </div>;
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
        <SearchDial deadline={game.phase === 'waiting' ? game.deadline : undefined} />
        <div role="status">
          <h2 className="font-heading text-xl font-semibold">{game.phase === 'waiting' ? 'Searching for an opponent' : 'Search timed out'}</h2>
          <p className="mt-1 text-sm text-muted">{game.phase === 'waiting' ? 'Looking for a ready three-player team on the opposite side.' : 'No opposing team was found in two minutes.'}</p>
        </div>
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
