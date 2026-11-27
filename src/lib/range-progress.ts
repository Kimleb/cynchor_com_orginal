import { getDb } from '@/lib/db';
import { RANGE_LEVELS } from '@/lib/range-levels';

export interface UserLevelStatus {
  levelId: number;
  unlocked: boolean;
  completed: boolean;
  bestScore: number;
}

export interface LeaderboardEntry {
  username: string;
  side: string;
  best_score: number;
  vault_remaining: number;
  created_at: string;
}

export async function getUserLevelProgress(username: string): Promise<UserLevelStatus[]> {
  const db = getDb();
  const now = new Date().toISOString();

  // Level 1 is always unlocked for every player
  await db.prepare(`
    INSERT INTO level_progress (username, level_id, unlocked_at)
    VALUES (?, 1, ?) ON CONFLICT (username, level_id) DO NOTHING
  `).run(username, now);

  const rows = (await db
    .prepare('SELECT level_id, unlocked_at, completed_at, best_score FROM level_progress WHERE username = ?')
    .all(username)) as Array<{
    level_id: number;
    unlocked_at: string;
    completed_at: string | null;
    best_score: number;
  }>;

  const byLevel = new Map(rows.map((r) => [r.level_id, r]));

  return RANGE_LEVELS.map((lvl) => {
    const row = byLevel.get(lvl.id);
    return {
      levelId: lvl.id,
      unlocked: lvl.id === 1 || row !== undefined,
      completed: Boolean(row?.completed_at),
      bestScore: Number(row?.best_score ?? 0),
    };
  });
}

export async function completeLevelForUser(username: string, levelId: number, score: number): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO level_progress (username, level_id, unlocked_at, completed_at, best_score)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username, level_id) DO UPDATE SET
      completed_at = COALESCE(level_progress.completed_at, excluded.completed_at),
      best_score = CASE WHEN excluded.best_score > level_progress.best_score THEN excluded.best_score ELSE level_progress.best_score END
  `).run(username, levelId, now, now, score);

  // Unlock level N+1 if it exists
  const nextLevel = levelId + 1;
  if (RANGE_LEVELS.some((l) => l.id === nextLevel)) {
    await db.prepare(`
      INSERT INTO level_progress (username, level_id, unlocked_at)
      VALUES (?, ?, ?) ON CONFLICT (username, level_id) DO NOTHING
    `).run(username, nextLevel, now);
  }
}

export async function getLevelLeaderboard(levelId: number, limit = 10): Promise<LeaderboardEntry[]> {
  const db = getDb();
  return (await db
    .prepare(`
      SELECT username, side, MAX(score) AS best_score, MAX(vault_remaining) AS vault_remaining, MAX(created_at) AS created_at
      FROM range_scores
      WHERE level_id = ?
      GROUP BY username, side
      ORDER BY best_score DESC, created_at ASC
      LIMIT ?
    `)
    .all(levelId, limit)) as unknown as LeaderboardEntry[];
}
