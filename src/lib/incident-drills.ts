export const drills = [
  { title: 'Session containment', brief: 'The branch lost terminal K-17. Use the device register to revoke every session on that terminal and keep the other tills online.', action: 'Revoke session', state: 'Revoked', asset: 'Session', evidence: ['Till K-08 · West branch', 'Till K-17 · Payments', 'Till K-22 · East branch', 'Till K-17 · Statements'], targets: [1,3] },
  { title: 'Statement quarantine', brief: 'The privacy desk flagged a statement export. Compare the requesting account with the document owner. Quarantine each mismatched export.', action: 'Quarantine export', state: 'Quarantined', asset: 'Export', evidence: ['Requester A41 · Owner A18','Requester A26 · Owner A26','Requester A19 · Owner A34','Requester A72 · Owner A72'], targets: [0,2] },
  { title: 'Settlement reconciliation', brief: 'Compare payment references. Keep the earliest entry for each reference and hold the later duplicates.', action: 'Hold entry', state: 'Held', asset: 'Entry', evidence: ['09:04 · P-91 · $120','09:06 · P-32 · $185','09:08 · P-91 · $120','09:12 · P-32 · $185'], targets: [2,3] },
  { title: 'Privilege review', brief: 'The approved change register lists CH-71 and CH-94. Suspend grants that cannot be traced to either approval.', action: 'Suspend grant', state: 'Suspended', asset: 'Grant', evidence: ['Admin · CH-11','Supervisor · CH-71','Supervisor · CH-94','Admin · No ticket'], targets: [0,3] },
];
export type DrillPlayer = {id:string; handle:string; side:string; practical?:boolean; held?:number[]; choice?:number};
export function drillView(players:DrillPlayer[], me:DrillPlayer, level:number, seed:string) {
  const {targets, evidence, ...brief} = drills[level-1];
  const offset = parseInt(seed.slice(0,2),16) % evidence.length;
  return {
    ...brief,
    records: evidence.map((_,i) => {
      const id = (i+offset) % evidence.length;
      return {id, label: brief.asset+' '+(100+i), evidence:evidence[id], held:me.held?.includes(id) ?? false};
    }),
    roster: players.map(p => ({handle:p.handle, side:p.side, you:p.id===me.id, done:p.choice!==undefined})),
  };
}
