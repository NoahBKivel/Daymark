import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { readFileSync } from 'node:fs';

export async function testDatabase() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  class Statement {
    args: SqlValue[] = [];
    constructor(readonly sql: string) {}
    bind(...args: SqlValue[]) {
      this.args = args;
      return this;
    }
    async all() {
      const stmt = sqlite.prepare(this.sql);
      try {
        stmt.bind(this.args);
        const results: Record<string, SqlValue>[] = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        return {
          success: true,
          results,
          meta: {
            changes: sqlite.getRowsModified(),
            duration: 0,
            rows_read: results.length,
            rows_written: sqlite.getRowsModified(),
          },
        };
      } finally {
        stmt.free();
      }
    }
    async first(column?: string) {
      const { results } = await this.all();
      return results[0] ? (column ? results[0][column] : results[0]) : null;
    }
    async run() {
      return this.all();
    }
    async raw() {
      const { results } = await this.all();
      return results.map((r) => Object.values(r));
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.run('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.run('COMMIT');
        return results;
      } catch (e) {
        sqlite.run('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      sqlite.run(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
  for (const id of ['alice', 'bob'])
    sqlite.run(
      'INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      [id, id, `${id}@example.com`, 1, 0, 0],
    );
  return { db, sqlite };
}
