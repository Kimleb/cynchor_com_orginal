'use client';
import type { IncidentView } from '@/lib/incident-game';
import { lanes } from '@/lib/transfer-game';

export default function TransferDesk({game,busy,act}:{game:IncidentView;busy:boolean;act:(action:string,id:number)=>void}) {
  const board=game.bank!;
  const red=board.side==='RED', live=game.phase==='playing';
  const button='rounded-lg border border-teal/50 px-3 py-2 text-sm disabled:opacity-40';
  return <section className="space-y-4">
    <header className="rounded-xl border border-teal/30 bg-teal/10 p-4"><h2 className="font-heading text-xl font-bold">Bank clearing desk</h2>
      <p className="text-sm">Level {game.level} · {red?'Red squad · Dispatch':'Blue squad · Interception'}</p></header>
    <div className="grid grid-cols-2 gap-3">{['RED','BLUE'].map(side=><div className="rounded-xl border border-border p-3" key={side}>
      <strong className={side==='RED'?'text-coral':'text-teal'}>{side} · {side==='RED'?board.red:board.blue} pts</strong>
      {board.roster.filter(p=>p.side===side).map(p=><p key={p.handle} className="break-all text-sm">@{p.handle}{p.you?' (you)':''}</p>)}</div>)}</div>
    {live && <><p>{red?'Send a simulated transfer from each desk. Each one that clears earns 100 points.':'Watch the shared ledger. Freeze a pending transfer before it clears to earn 100 points.'}</p>
      <p className="text-sm text-muted">Round closes at {new Date(game.deadline!).toLocaleTimeString()}</p>
      {red && <div className="flex flex-wrap gap-2">{lanes.map((lane,i)=><button key={lane} className={button} disabled={busy || board.spent.includes(i)} onClick={()=>act('dispatch',i)}>{board.spent.includes(i)?'Sent':'Send'} · {lane}</button>)}</div>}</>}
    <h3 className="font-semibold">Shared transfer ledger</h3>
    {!board.ledger.length && <p className="text-sm text-muted">No transfers dispatched yet.</p>}
    {board.ledger.map(t=><div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
      <div>{t.lane}<p className="text-xs text-muted">@{t.sender} · {t.state==='Pending'?'Clears at '+new Date(t.settles).toLocaleTimeString():t.state}</p></div>
      {!red && live && t.state==='Pending' && <button className={button} disabled={busy} onClick={()=>act('intercept',t.id)}>Freeze transfer</button>}</div>)}
  </section>;
}
