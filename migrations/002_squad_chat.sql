BEGIN;
CREATE TABLE IF NOT EXISTS cynchor.squad_messages (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES cynchor.teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES cynchor.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 400),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS squad_messages_team_time ON cynchor.squad_messages(team_id, created_at, id);
ALTER TABLE cynchor.squad_messages ENABLE ROW LEVEL SECURITY;
COMMIT;
