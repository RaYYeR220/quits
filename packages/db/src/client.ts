import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

/** Where the SQL migrations live, whichever directory the process started in. */
export function migrationsFolder(): string {
  const candidates = [
    process.env.QUITS_MIGRATIONS,
    join(process.cwd(), 'packages', 'db', 'migrations'),
    join(process.cwd(), '..', '..', 'packages', 'db', 'migrations'),
    join(process.cwd(), 'migrations'),
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => existsSync(join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`migrations folder not found (looked in ${candidates.join(', ')})`);
  return resolve(found);
}

/** Postgres over the network. */
export async function connectDb(url: string, opts: { migrate?: boolean; max?: number } = {}): Promise<Db> {
  const client = postgres(url, { max: opts.max ?? 5, prepare: false, ...(url.includes('sslmode=require') ? { ssl: 'require' as const } : {}) });
  const db = drizzlePg(client, { schema });
  if (opts.migrate) await migratePg(db, { migrationsFolder: migrationsFolder() });
  return db;
}

/** In-process Postgres (PGlite) for tests, local runs and the offline benchmark. */
export async function memoryDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migratePglite(db, { migrationsFolder: migrationsFolder() });
  return db as unknown as Db;
}
