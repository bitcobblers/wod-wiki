/**
 * Connection contracts + a generic libsql adapter. The adapter takes a
 * *structural* client so the browser passes @libsql/client/web and the server
 * passes @libsql/client (node) — this module never imports either, keeping
 * the browser graph free of native drivers.
 *
 * All operations are serialized through one promise chain: the underlying
 * client shares a single connection, so concurrent transactions/reads could
 * otherwise interleave on it. Transactions run on a transaction-owned
 * connection (libsql interactive transaction), so writes inside a transaction
 * commit or roll back atomically and are not visible outside it.
 */

import type { Client } from '@libsql/client';

import { StorageError } from './errors';
export type SqlValue = string | number | null; // booleans bound as 1/0 by callers
export type SqlRow = Record<string, unknown>;

export interface SqlStatement { sql: string; params?: SqlValue[] }
export interface SqlConnection {
  query(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  exec(sql: string, params?: SqlValue[]): Promise<void>;
  batch?(statements: SqlStatement[]): Promise<SqlRow[][]>;
}

export interface Database extends SqlConnection {
  readonly dialect: 'sqlite' | 'postgres';
  transaction<T>(fn: (tx: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Minimal surface used from a libsql client (node or web build) — the real
 * @libsql/client types, type-only so the browser graph stays driver-free. */
export type LibsqlClient = Pick<Client, 'execute' | 'transaction' | 'close'>;

function libsqlRows(result: { rows: ArrayLike<Record<string, unknown>> }): SqlRow[] {
  return result.rows as unknown as SqlRow[];
}

/** Wrap a libsql client (node or web build) into the shared Database surface. */
export function libsqlDatabase(client: LibsqlClient): Database {
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
  return {
    dialect: 'sqlite',
    query: (sql, params = []) => serialize(() => client.execute({ sql, args: params }).then(libsqlRows)),
    exec: async (sql, params = []) => {
      await serialize(() => client.execute({ sql, args: params }));
    },
    transaction<T>(fn: (tx: SqlConnection) => Promise<T>): Promise<T> {
      return serialize(async () => {
        const tx = await client.transaction('write');
        try {
          const txConn: SqlConnection = {
            query: (sql, params = []) => tx.execute({ sql, args: params }).then(libsqlRows),
            exec: async (sql, params = []) => {
              await tx.execute({ sql, args: params });
            },
            batch: async (statements) => (await tx.batch(statements.map(({ sql, params = [] }) => ({ sql, args: params })))).map(libsqlRows),
          };
          const result = await fn(txConn);
          await tx.commit();
          return result;
        } catch (err) {
          try {
            await tx.rollback();
          } catch {
            // transaction already closed by the failed statement
          }
          const message = err instanceof Error ? err.message : String(err);
          for (const code of ['revision_conflict', 'transaction_conflict', 'invalid_session_pin']) {
            if (message.includes(code)) throw new StorageError(409, message, code);
          }
          throw err;
        } finally {
          tx.close();
        }
      });
    },
    close: async () => {
      await chain;
      client.close();
    },
  };
}
