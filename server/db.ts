import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
export const db = new PrismaClient();
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const audit = (userId: string, action: string, entityId: string, data: unknown = {}) =>
  db.audit.create({ data: { userId, action, entityId, data: json(data) } });
