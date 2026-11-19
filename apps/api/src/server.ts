import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createPaymentProvider } from './lib/payment-provider';
import { RealtimeHub } from './lib/realtime';
import { LocalStorage, SupabaseStorage } from './lib/storage';
import type { MediaStorage } from './lib/storage';
import { createTokenVerifier } from './lib/token-verifier';
import { contextOf } from './modules/routes';
import { startSweeper } from './modules/sweeper';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);

const storage: MediaStorage = config.SUPABASE_SECRET_KEY
  ? new SupabaseStorage(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, config.STORAGE_BUCKET)
  : new LocalStorage(
      resolve(process.cwd(), config.MEDIA_DIR),
      config.PUBLIC_API_URL ?? `http://127.0.0.1:${config.PORT}`,
      config.MEDIA_SIGNING_SECRET ?? randomBytes(32).toString('hex'),
    );

const app = await buildApp({
  config,
  db,
  payments: createPaymentProvider(config),
  verifyToken: createTokenVerifier(config),
  storage,
  realtime: new RealtimeHub(),
});

try {
  await storage.ensureReady();
} catch (err) {
  // Uploads fail until storage recovers, but the rest of the product keeps working.
  app.log.error({ err }, 'Media storage is not ready');
}
const stopSweeper = config.SWEEPER ? startSweeper(contextOf(app), app.log) : () => {};

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'Shutting down after an error');
  stopSweeper();
  await app.close();
  await close();
});

await app.listen({ host: config.HOST, port: config.PORT });
