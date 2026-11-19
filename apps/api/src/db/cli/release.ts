import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from '../client';
import { seedCatalogue } from '../seed';

/** Runs before the server starts (see the Dockerfile). A failure stops the container before it takes traffic. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(url, 1);
await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
const seeded = await seedCatalogue(db);
await close();
console.log(`Migrations applied. ${seeded ? 'Catalogue seeded.' : 'Catalogue left unchanged.'}`);
