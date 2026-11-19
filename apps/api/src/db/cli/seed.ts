import { createDatabase } from '../client';
import { seedCatalogue } from '../seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(url, 1);
const seeded = await seedCatalogue(db);
await close();
console.log(seeded ? 'Catalogue seeded' : 'Catalogue already present, nothing changed');
