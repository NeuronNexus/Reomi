import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { createPaymentProvider } from './lib/payment-provider';
import { createTokenVerifier } from './lib/token-verifier';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);

const app = await buildApp({
  config,
  db,
  payments: createPaymentProvider(config),
  verifyToken: createTokenVerifier(config),
});

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'Shutting down after an error');
  await app.close();
  await close();
});

await app.listen({ host: config.HOST, port: config.PORT });
