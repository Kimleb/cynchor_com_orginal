import type { DrillPlayer } from './incident-drills';

export type Transfer = { slot:number; settles:number; stoppedBy?:string };
export type BankPlayer = DrillPlayer & { transfers?:Transfer[] };
export const lanes = ['Branch clearing','Card settlement','Wire desk'];
export function transferView(players:BankPlayer[], me:BankPlayer, now:number) {
  const ledger = players.flatMap((p, index) => (p.transfers ?? []).map(t => ({
    id:index*3+t.slot, lane:lanes[t.slot], sender:p.handle, settles:t.settles,
    state:t.stoppedBy ? 'Blocked' : t.settles <= now ? 'Settled' : 'Pending',
  })));
  return {
    side:me.side, ledger, spent:me.transfers?.map(t=>t.slot) ?? [],
    red:ledger.filter(t=>t.state==='Settled').length*100, blue:ledger.filter(t=>t.state==='Blocked').length*100,
    roster:players.map(p=>({handle:p.handle,side:p.side,you:p.id===me.id})),
  };
}

export function transferPoints(players:BankPlayer[], p:BankPlayer, now:number) {
  if (p.side==='RED') return (p.transfers ?? []).filter(t=>!t.stoppedBy && t.settles<=now).length*100;
  return players.flatMap(owner=>owner.transfers ?? []).filter(t=>t.stoppedBy===p.id).length*100;
}

export function moveTransfer(players:BankPlayer[], me:BankPlayer, action:string, target:unknown, now:number, end:number, level:number) {
  if (typeof target!=='number' || !Number.isInteger(target) || target<0) return 'Select a transfer desk.';
  if (action==='dispatch' && me.side==='RED' && target<3) {
    if (me.transfers!.some(t=>t.slot===target)) return;
    const settles = now + (17-level*2)*1000;
    if (settles>end) return 'Dispatch has closed. Pending transfers are clearing.';
    me.transfers!.push({slot:target,settles});
    return;
  }
  if (action==='intercept' && me.side==='BLUE') {
    const transfer = players[Math.floor(target/3)]?.transfers?.find(t=>t.slot===target%3);
    if (!transfer || transfer.settles<=now) return 'The transfer is no longer pending.';
    if (!transfer.stoppedBy) transfer.stoppedBy=me.id;
    return;
  }
  return 'Your squad cannot perform this action.';
}
