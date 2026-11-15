import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './db';
const email = process.env.BOOTSTRAP_EMAIL?.toLowerCase(),
  password = process.env.BOOTSTRAP_PASSWORD;
if (!email || !password || password.length < 14 || password.includes('SET_A_'))
  throw Error('Укажите BOOTSTRAP_EMAIL и уникальный BOOTSTRAP_PASSWORD длиной от 14 символов');
await db.user.upsert({
  where: { email },
  create: { email, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' },
  update: {},
});
console.log('Администратор создан (существующий пароль не изменяется)');
await db.$disconnect();
