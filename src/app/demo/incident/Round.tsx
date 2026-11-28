'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { IncidentView } from '@/lib/incident-game';
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
      {game?.phase === 'waiting' && <><p>Waiting for a three-player team on the opposite side.</p><button className={button} disabled={busy} onClick={()=>act('cancel')}>Cancel search</button></>}
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
