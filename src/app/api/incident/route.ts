import { getCurrentUser } from '@/lib/session';
import { incidentGame, GameError } from '@/lib/incident-game';
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:'Sign in to play.'},{status:401});
  const body = await request.json().catch(() => null);
  if (!['status','queue','answer','cancel'].includes(body?.action)) return Response.json({error:'Invalid action.'},{status:400});
  try { return Response.json(await incidentGame(user.id,body.action,body.id,body.choice)); }
  catch (error) {
    if (error instanceof GameError) return Response.json({error:error.message},{status:409});
    console.error('Incident round request failed', {code:(error as {code?:string})?.code});
    return Response.json({error:'Could not load the round. Please retry.'},{status:503});
  }
}
