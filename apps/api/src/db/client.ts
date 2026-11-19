import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const createDatabase = (url: string, poolMax: number) => {
  // prepare:false keeps this working behind Supabase's transaction-mode pooler.
  const client = postgres(url, { max: poolMax, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
};

export type Db = ReturnType<typeof createDatabase>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
