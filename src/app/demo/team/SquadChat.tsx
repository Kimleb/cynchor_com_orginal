'use client';
import { useState,useEffect,useCallback,useRef } from 'react';
type Room={teamId:string;side:string;messages:{id:string;username:string;message:string}[]};
export default function SquadChat() {
  const [room,setRoom]=useState<Room>(),[draft,setDraft]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
  const serial=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++serial.current;
    try {
      const res=await fetch('/api/squad-chat',{cache:'no-store'});
      const data=await res.json();
      if(request!==serial.current)return;
      if(!res.ok) {setRoom(undefined);throw new Error(data.error);}
      setRoom(data);
    }catch{if(request===serial.current)setError('Chat is temporarily unavailable.');}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(refresh,3500);return ()=>{clearInterval(timer);serial.current++;};},[refresh]);
  async function send(){
    if(!room || sending || !draft.trim())return;
    setSending(true);setError('');
    try{
      const res=await fetch('/api/squad-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamId:room.teamId,message:draft})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error);
      serial.current++;setRoom(data);setDraft('');
    }catch(e){setError(e instanceof Error?e.message:'Could not send message.');}
    finally{setSending(false);}
  }
  return <section className="space-y-3 rounded-2xl border border-border bg-surface p-5">
    <h2 className="font-heading text-lg font-semibold">{room?.side==='RED'?'Red squad':room?.side==='BLUE'?'Blue squad':'Squad'} chat</h2>
    <div className="max-h-52 overflow-y-auto rounded-lg border border-border p-3 text-sm" role="log" aria-label="Private squad messages">
      {room && !room.messages.length && <p className="text-muted">Coordinate privately with your squad.</p>}
      {room?.messages.map(m=><p key={m.id} className="break-words"><strong>@{m.username}</strong> {m.message}</p>)}</div>
    <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void send();}}>
      <input className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2" aria-label="Squad message" placeholder="Message your squad" maxLength={400} value={draft} disabled={sending} onChange={e=>setDraft(e.target.value)}/>
      <button className="rounded-lg bg-teal px-4 text-bg disabled:opacity-50" disabled={!room || !draft.trim() || sending}>Send</button></form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
