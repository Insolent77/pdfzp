// Disposable local review server. Never used by production startup.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
if (!process.env.PREVIEW_PASSWORD || process.env.PREVIEW_PASSWORD.length < 14)
  throw Error('Set PREVIEW_PASSWORD for the temporary local reviewer');
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:55440/postgres?connection_limit=1&sslmode=disable';
process.env.SESSION_SECRET = 'temporary-local-review-session-secret-rotates-with-database';
process.env.APP_URL = 'http://127.0.0.1:3000';
process.env.NODE_ENV = 'development';
const pg = await PGlite.create();
await pg.exec(await readFile('prisma/migrations/202611150001_initial/migration.sql', 'utf8'));
await pg.exec(
  await readFile('prisma/migrations/202611150002_plain_google_tokens/migration.sql', 'utf8'),
);
const socket = new PGLiteSocketServer({
  db: pg,
  port: 55440,
  host: '127.0.0.1',
  maxConnections: 10,
});
await socket.start();
const { db } = await import('../server/db');
const { createApp } = await import('../server/app');
await db.user.create({
  data: {
    email: 'review@localhost.ru',
    passwordHash: await bcrypt.hash(process.env.PREVIEW_PASSWORD, 10),
    role: 'ADMIN',
  },
});
const app = createApp();
const server = app.listen(3000, '127.0.0.1', () =>
  console.log(
    'Disposable review server: http://127.0.0.1:3000; database is empty, no real personal data loaded',
  ),
);
process.on('SIGINT', async () => {
  server.close();
  await app.locals.close();
  await db.$disconnect();
  await socket.stop();
  await pg.close();
  process.exit(0);
});
