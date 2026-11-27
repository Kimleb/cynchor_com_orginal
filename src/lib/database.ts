import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { types, Pool, type PoolClient } from 'pg';

type Parameter = string | number | bigint | null | Uint8Array;
type Row = Record<string, any>;
type Context = { client?: PoolClient; depth: number };

export function postgresSchema() {
  const schema = process.env.CYNCHOR_POSTGRES_SCHEMA || 'cynchor';
  if (!/^cynchor(?:_[a-z][a-z0-9_]{0,31})?$/.test(schema)) throw new Error('Invalid Postgres schema name');
  return schema;
}

export function createPostgresPool() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const certificate = process.env.DATABASE_CA_FILE;
  if (!certificate) throw new Error('DATABASE_CA_FILE is required for Postgres');
  // Use explicit connection fields so URL SSL options cannot replace the trusted CA.
  const schema = postgresSchema();
  const pool = new Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { ca: readFileSync(certificate, 'utf8'), rejectUnauthorized: true, servername: url.hostname },
    types: {
      getTypeParser: (oid, format) => oid === 20 && format !== 'binary'
        ? (value: string) => {
          const result = Number(value);
          if (!Number.isSafeInteger(result)) throw new Error('Postgres integer exceeds JavaScript precision');
          return result;
        }
        : types.getTypeParser(oid, format),
    },
    onConnect: async client => { await client.query('SET search_path = ' + schema + ', pg_catalog'); },
    max: 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });
  pool.on('error', () => console.error('An idle Postgres connection closed unexpectedly.'));
  return pool;
}

export class ApplicationDatabase {
  private context = new AsyncLocalStorage<Context>();
  private sqliteQueue = Promise.resolve();

  constructor(private readonly sqlite?: DatabaseSync, private readonly pool?: Pool) {}

  private async exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    const previous = this.sqliteQueue;
    let release!: () => void;
    this.sqliteQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  prepare(sql: string) {
    const execute = async (method: 'get' | 'all' | 'run', values: Parameter[]) => {
      if (this.sqlite) return this.exclusive(() => this.sqlite!.prepare(sql)[method](...values));
      let index = 0;
      const query = sql.replace(/'(?:''|[^'])*'|\?/g, match => match === '?' ? '$' + ++index : match);
      const result = await (this.context.getStore()?.client ?? this.pool!).query(query, values);
      if (method === 'run') return { changes: result.rowCount ?? 0 };
      return method === 'get' ? result.rows[0] : result.rows;
    };
    return {
      get: (...values: Parameter[]): Promise<Row | undefined> => execute('get', values),
      all: (...values: Parameter[]): Promise<Row[]> => execute('all', values),
      run: (...values: Parameter[]): Promise<{ changes: number }> => execute('run', values),
    };
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const current = this.context.getStore();
    const run = async (client?: PoolClient) => {
      const depth = (current?.depth ?? -1) + 1;
      const savepoint = 'cynchor_transaction_' + depth;
      const execute = async (sql: string) => {
        if (client) await client.query(sql);
        else this.sqlite!.exec(sql);
      };
      await execute(current ? 'SAVEPOINT ' + savepoint : client ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try {
        if (client && !current) await client.query('SELECT pg_advisory_xact_lock(1129926216)');
        const result = await this.context.run({ client, depth }, work);
        await execute(current ? 'RELEASE SAVEPOINT ' + savepoint : 'COMMIT');
        return result;
      } catch (error) {
        await execute(current ? 'ROLLBACK TO SAVEPOINT ' + savepoint : 'ROLLBACK');
        if (current) await execute('RELEASE SAVEPOINT ' + savepoint);
        throw error;
      }
    };
    if (current) return run(current.client);
    if (this.sqlite) return this.exclusive(() => run());
    const client = await this.pool!.connect();
    try { return await run(client); } finally { client.release(); }
  }
}
