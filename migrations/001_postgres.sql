CREATE SCHEMA cynchor;

REVOKE ALL ON SCHEMA cynchor FROM PUBLIC;

SET LOCAL search_path = cynchor, pg_catalog;

CREATE TABLE "users" (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT, experience_level TEXT, is_profile_completed INTEGER DEFAULT 0,
    is_operator INTEGER DEFAULT 0, created_at TEXT NOT NULL, session_version INTEGER NOT NULL DEFAULT 0);

CREATE TABLE "access_requests" (id TEXT PRIMARY KEY, note TEXT, status TEXT DEFAULT 'PENDING',
    source TEXT NOT NULL DEFAULT 'demo', created_at TEXT NOT NULL, approved_at TEXT,
    claim_token_hash TEXT, generated_invite_token TEXT);

CREATE TABLE "invites" (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, username TEXT,
    purpose TEXT NOT NULL DEFAULT 'CLAIM', target_user_id TEXT, is_used INTEGER DEFAULT 0,
    used_at TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE zipi_operators (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, secret TEXT NOT NULL,
      last_counter BIGINT NOT NULL DEFAULT -1, attempts INTEGER NOT NULL DEFAULT 0,
      window_end BIGINT NOT NULL DEFAULT 0
    );

CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      is_complete INTEGER DEFAULT 0,
      status TEXT DEFAULT 'RECRUITING',
      created_at TEXT NOT NULL
    );

CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

CREATE TABLE disclaimers (
      id TEXT PRIMARY KEY,
      accepted_at TEXT NOT NULL,
      user_identifier TEXT NOT NULL,
      ip_address TEXT,
      version TEXT DEFAULT 'v1.1'
    );

CREATE TABLE level_progress (
      username TEXT NOT NULL,
      level_id INTEGER NOT NULL,
      unlocked_at TEXT NOT NULL,
      completed_at TEXT,
      best_score INTEGER DEFAULT 0,
      PRIMARY KEY (username, level_id)
    );

CREATE TABLE match_sessions (
      id TEXT PRIMARY KEY,
      red_team_id TEXT,
      blue_team_id TEXT,
      mode TEXT NOT NULL,
      side TEXT,
      user_id TEXT,
      lab_id TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    , level_id INTEGER, red_username TEXT, blue_username TEXT, vault_balance BIGINT DEFAULT 10000000, red_score INTEGER DEFAULT 0, blue_score INTEGER DEFAULT 0, winner TEXT, container_id TEXT, network_id TEXT, target_host TEXT, target_port INTEGER, expires_at TEXT, ended_at TEXT, summary_json TEXT, roe_accepted_red INTEGER DEFAULT 0, roe_accepted_blue INTEGER DEFAULT 0);

CREATE TABLE matchmaking_queue (
      id TEXT PRIMARY KEY,
      team_id TEXT UNIQUE,
      side TEXT NOT NULL,
      status TEXT DEFAULT 'WAITING',
      joined_at TEXT NOT NULL
    , level_id INTEGER, user_id TEXT, username TEXT, roe_accepted INTEGER DEFAULT 0);

CREATE TABLE product_access_mail (
    request_id TEXT PRIMARY KEY REFERENCES access_requests(id),
    applicant_name TEXT NOT NULL, reply_email TEXT NOT NULL,
    next_attempt BIGINT NOT NULL DEFAULT 0, accepted_at BIGINT
  );

CREATE TABLE range_scores (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      level_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      side TEXT NOT NULL,
      score INTEGER NOT NULL,
      vault_remaining BIGINT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(team_id, user_id)
    );

CREATE TABLE zipi_challenges (
      token_hash TEXT PRIMARY KEY, operator_id TEXT NOT NULL UNIQUE REFERENCES zipi_operators(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, expires BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE zipi_sessions (
      token_hash TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES zipi_operators(id) ON DELETE CASCADE,
      expires BIGINT NOT NULL
    );

CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE INDEX pending_product_mail ON product_access_mail(next_attempt) WHERE accepted_at IS NULL;

CREATE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
