import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from '../client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(url, 1);
await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
await close();
console.log('Migrations applied');
