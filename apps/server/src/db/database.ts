import { Kysely, MysqlDialect, PostgresDialect, type Dialect } from 'kysely';
import type { Config } from '../config.js';
import type { DB } from './schema.js';

export type Database = Kysely<DB>;

type DbConfig = Pick<Config, 'DB_DIALECT' | 'DATABASE_URL' | 'DB_POOL_SIZE'>;

/**
 * The only place that knows which SQL engine is in use.
 * Both drivers are configured to return JSON columns as raw strings and bigint as number,
 * so repositories behave identically on MySQL and PostgreSQL.
 */
export async function createDatabase(config: DbConfig): Promise<Database> {
  return new Kysely<DB>({ dialect: await createDialect(config) });
}

async function createDialect({ DB_DIALECT, DATABASE_URL, DB_POOL_SIZE }: DbConfig): Promise<Dialect> {
  switch (DB_DIALECT) {
    case 'mysql': {
      const { createPool } = await import('mysql2');
      return new MysqlDialect({
        pool: createPool({ uri: DATABASE_URL, connectionLimit: DB_POOL_SIZE, charset: 'utf8mb4', jsonStrings: true }),
      });
    }
    case 'postgres': {
      const { default: pg } = await import('pg');
      const JSON_OIDS = new Set([114, 3802]);
      const INT8_OID = 20;
      const types = {
        getTypeParser: (oid: number, format?: 'text' | 'binary') => {
          if (JSON_OIDS.has(oid)) return (v: string) => v;
          if (oid === INT8_OID) return Number;
          return pg.types.getTypeParser(oid, format);
        },
      };
      return new PostgresDialect({ pool: new pg.Pool({ connectionString: DATABASE_URL, max: DB_POOL_SIZE, types }) });
    }
  }
}

export const toJson = (value: unknown) => JSON.stringify(value ?? null);
export const fromJson = <T>(value: unknown): T => JSON.parse(value as string) as T;
