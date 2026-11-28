import {randomUUID} from 'node:crypto';
import {getDb} from './db';

export async function squadChat(userId:string, post?:{teamId:unknown;message:unknown}) {
  const db=getDb();
  return db.transaction(async()=>{
    const team=await db.prepare('SELECT m.team_id,m.joined_at,t.side FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? ORDER BY m.joined_at DESC LIMIT 1').get(userId);
    if (!team || (post && team.team_id!==post.teamId)) return {status:403,data:{error:'Join the squad to access this chat.'}};
    if (post) {
      const message=typeof post.message==='string'?post.message.trim():'';
      if (!message || message.length>400) return {status:400,data:{error:'Enter 1–400 characters.'}};
      const recent=await db.prepare('SELECT id FROM squad_messages WHERE team_id=? AND user_id=? AND created_at>? LIMIT 1')
        .get(team.team_id,userId,new Date(Date.now()-1500).toISOString());
      if (recent) return {status:429,data:{error:'Wait a moment before sending again.'}};
      await db.prepare('INSERT INTO squad_messages (id,team_id,user_id,message,created_at) VALUES (?,?,?,?,?)')
        .run(randomUUID(),team.team_id,userId,message,new Date().toISOString());
    }
    const messages=await db.prepare(`SELECT s.id,u.username,s.message FROM squad_messages s JOIN users u ON u.id=s.user_id
      WHERE s.team_id=? AND s.created_at>=? ORDER BY s.created_at DESC,s.id DESC LIMIT 40`).all(team.team_id,team.joined_at);
    return {status:200,data:{teamId:team.team_id,side:team.side,messages:messages.reverse()}};
  });
}
