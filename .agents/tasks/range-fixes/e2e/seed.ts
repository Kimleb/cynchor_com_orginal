// Seeds 2 red + 2 blue + 1 spectator users with known passwords and two squads into CYNCHOR_DB_PATH.
import { getDb, hashPassword } from '../../../../src/lib/db';
const db = getDb();
const now = new Date().toISOString();
const mk = (id: string, name: string, role: string) =>
  db.prepare("INSERT OR REPLACE INTO users (id, email, password_hash, name, role, experience_level, is_profile_completed, created_at) VALUES (?, ?, ?, ?, ?, 'EXPERT', 1, ?)")
    .run(id, `${id}@e2e.example.test`, hashPassword('E2e-Passw0rd!'), name, role, now);
mk('e2e_red1', 'RedOne', 'RED_TEAM'); mk('e2e_red2', 'RedTwo', 'RED_TEAM');
mk('e2e_blue1', 'BlueOne', 'BLUE_TEAM'); mk('e2e_blue2', 'BlueTwo', 'BLUE_TEAM');
mk('e2e_spec', 'Watcher', 'GRC');
const team = (id: string, name: string, side: string, members: string[]) => {
  db.prepare("INSERT OR REPLACE INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, ?, 1, 'RECRUITING', ?)").run(id, name, side, members[0], now);
  for (const m of members) db.prepare('INSERT OR REPLACE INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(`tm_${id}_${m}`, id, m, now);
};
team('e2e_team_red', 'Crimson Squad', 'RED', ['e2e_red1', 'e2e_red2']);
team('e2e_team_blue', 'Azure Squad', 'BLUE', ['e2e_blue1', 'e2e_blue2']);
db.prepare("DELETE FROM matchmaking_queue").run();
console.log('seeded');
