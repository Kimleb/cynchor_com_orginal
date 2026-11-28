'use client';
import { useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import type { IncidentView } from '@/lib/incident-game';

export default function MatchDesk({game,busy,act}:{game:IncidentView;busy:boolean;act:(action:string,id?:number)=>void}) {
  const drill = game.drill!;
  const own = drill.roster.find(p=>p.you)?.side;
  const [side,setSide] = useState(own);
  const [open,setOpen] = useState(false);
  const locked = game.choice !== undefined || game.phase === 'finished';
  return <div className="space-y-5">
    <header className="flex items-center gap-3 rounded-xl border border-teal/30 bg-teal/10 p-4 text-teal">
      <ShieldCheck aria-hidden="true" /><div><h2 className="font-heading font-bold">{game.phase === 'finished' ? 'Exercise complete' : 'Match found · Squads ready'}</h2>
      <p className="font-mono text-xs">3v3 · Banking range · Level {game.level}</p></div>
    </header>
    <div className="grid grid-cols-2 gap-2">{['RED','BLUE'].map(s=><button key={s} aria-pressed={side===s} onClick={()=>setSide(s)}
      className={'rounded-lg border p-2 text-sm '+(side!==s?'border-border text-muted':s==='RED'?'border-coral/60 bg-coral/10 text-coral':'border-teal/60 bg-teal/10 text-teal')}>{s==='RED'?'Red':'Blue'} squad {s===own?'· Yours':''}</button>)}</div>
    <ul className="space-y-1">{drill.roster.filter(p=>p.side===side).map(p=><li key={p.handle} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
      <Users size={16} className={side==='RED'?'text-coral':'text-teal'}/><span className="grow font-mono text-sm">@{p.handle}{p.you?' (you)':''}</span>
      <span className="text-xs text-muted">{p.done?'Submitted':game.phase==='finished'?'Time elapsed':'Ready'}</span></li>)}</ul>
    <div className="border-t border-border pt-4"><h3 className="font-heading text-xl font-semibold">{drill.title}</h3><p className="my-2 text-sm text-muted">{drill.brief}</p>
      {!locked && <p className="font-mono text-xs text-muted">Round ends at {new Date(game.deadline!).toLocaleTimeString()}</p>}</div>
    {!open && !locked ? <button className="rounded-lg bg-teal px-4 py-2 font-semibold text-bg" onClick={()=>setOpen(true)}>Open my workspace →</button> :
      <><ul className="space-y-2">{drill.records.map(r=><li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
        <div><strong className="text-sm">{r.label}</strong><p className="font-mono text-xs text-muted">{r.evidence}</p></div>
        <div className="flex items-center gap-2 text-sm"><span className={r.held?'text-teal':'text-muted'}>{r.held?drill.state:'Active'}</span>
        {!locked && <button disabled={busy} onClick={()=>act(r.held?'restore':'apply',r.id)} className="rounded-lg border border-border px-3 py-2">{r.held?'Restore':drill.action}</button>}</div></li>)}</ul>
      {!locked && <button disabled={busy} className="rounded-lg bg-teal px-4 py-2 font-semibold text-bg" onClick={()=>act('submit')}>Submit workspace</button>}
      {locked && <p role="status" className="text-sm text-muted">{game.phase==='finished' ? game.choice===1?'All affected records contained · 100 pts':game.choice===undefined?'Time elapsed before submission.':'Review the evidence. Contain every affected record and keep normal records active.' : 'Workspace saved. Waiting for the other players.'}</p>}</>}
  </div>;
}
