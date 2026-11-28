import { getCurrentUser } from '@/lib/session';
import { squadChat } from '@/lib/squad-chat';
export const dynamic='force-dynamic';
async function handle(req?:Request) {
  const user=await getCurrentUser();
  if (!user) return Response.json({error:'Sign in first.'},{status:401});
  const body=req ? await req.json().catch(()=>null) : undefined;
  if (req && (!body || typeof body!=='object')) return Response.json({error:'Invalid message.'},{status:400});
  const result=await squadChat(user.id,body);
  return Response.json(result.data,{status:result.status,headers:{'Cache-Control':'private, no-store'}});
}
export function GET(){return handle();}
export function POST(req:Request){return handle(req);}
