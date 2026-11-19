import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../client';
import { profiles } from '../schema';

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (!email) throw new Error('Usage: pnpm admin:grant <email>');

const { db, close } = createDatabase(url, 1);
const [row] = await db
  .update(profiles)
  .set({ role: 'admin' })
  .where(eq(sql`lower(${profiles.email})`, email))
  .returning({ id: profiles.id });
await close();

if (!row) {
  console.error(`No profile for ${email}. Sign in to the app once first, then run this again.`);
  process.exit(1);
}
console.log(`${email} is now an admin`);
