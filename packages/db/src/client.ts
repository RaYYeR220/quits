import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Postgres over the network (Supabase/Neon). */
export async function connectDb(url: string, opts: { migrate?: boolean; max?: number } = {}): Promise<Db> {
  const client = postgres(url, { max: opts.max ?? 5, prepare: false });
  const db = drizzlePg(client, { schema });
  if (opts.migrate) await migratePg(db, { migrationsFolder });
  return db;
}

/** In-process Postgres (PGlite) for tests and the offline benchmark. */
export async function memoryDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}
