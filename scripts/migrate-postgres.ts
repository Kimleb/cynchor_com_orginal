import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresPool, postgresSchema } from '../src/lib/database';

const tables = [
  'users', 'access_requests', 'invites', 'zipi_operators', 'teams', 'audit_logs', 'auth_sessions',
  'disclaimers', 'level_progress', 'match_sessions', 'matchmaking_queue', 'product_access_mail',
  'range_scores', 'team_members', 'zipi_challenges', 'zipi_sessions',
];
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

async function migrate(source: string) {
  const sqlite = new DatabaseSync(source, { readOnly: true });
  const pool = createPostgresPool();
  try {
    sqlite.exec('BEGIN');
    const integrity = sqlite.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok' || sqlite.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('The SQLite source did not pass its integrity checks');
    }
    const target = await pool.connect();
    try {
      await target.query('BEGIN');
      const schema = postgresSchema();
      await target.query(readFileSync(resolve('migrations/001_postgres.sql'), 'utf8').replace(/\bcynchor\b/g, schema));
      const counts: Array<[string, number]> = [];
      for (const table of tables) {
        const rows = sqlite.prepare('SELECT * FROM ' + quote(table)).all();
        if (rows.length) {
          const columns = Object.keys(rows[0]);
          const sql = 'INSERT INTO ' + quote(table) + ' (' + columns.map(quote).join(', ') + ') VALUES ';
          for (let offset = 0; offset < rows.length; offset += 100) {
            const parameters = rows.slice(offset, offset + 100).flatMap(row => columns.map(column => row[column]));
            const tuples = rows.slice(offset, offset + 100).map((_, index) =>
              '(' + columns.map((_, col) => '$' + (index * columns.length + col + 1)).join(', ') + ')');
            await target.query(sql + tuples.join(', '), parameters);
          }
        }
        const inserted = await target.query('SELECT count(*) AS count FROM ' + quote(table));
        if (Number(inserted.rows[0].count) !== rows.length) throw new Error('Row count mismatch for ' + table);
        counts.push([table, rows.length]);
      }
      await target.query('COMMIT');
      for (const [table, count] of counts) console.log(table + ': ' + count);
    } catch (error) {
      await target.query('ROLLBACK');
      throw error;
    } finally { target.release(); }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

if (!process.argv[2]) throw new Error('Pass the path to the source SQLite backup');
migrate(resolve(process.argv[2])).catch(error => {
  // Postgres error details may contain row values.
  console.error('Migration failed:', error instanceof Error && 'code' in error ? error.code : 'check configuration or source integrity');
  process.exitCode = 1;
});
