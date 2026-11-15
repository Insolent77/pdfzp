import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import readXlsxFile, { readSheetNames } from 'read-excel-file/node';
import { db, audit, json } from './db';
import {
  calculate,
  dateISO,
  monthKey,
  hash,
  type Rules,
  type Mapping,
  type Report,
} from './calculation';
import {
  oauth,
  googleClient,
  salary,
  syncDirectory,
  downloadDocx,
  uploadPdf,
  googleId,
} from './google';
import {
  preflight,
  renderDocx,
  convertDocx,
  saveDocument,
  storageRoot,
  type Confirmations,
} from './documents';
declare module 'express-session' {
  interface SessionData {
    userId: string;
    csrf: string;
    oauthState?: string;
    oauthVerifier?: string;
  }
}
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const teacherSchema = z.object({
  name: z.string().min(3).max(250),
  dativeName: z.string().max(250).default(''),
  kind: z.enum(['NPD', 'IP', 'UNKNOWN']).default('UNKNOWN'),
  spreadsheetId: z.string().max(300).default(''),
  folderId: z.string().max(300).default(''),
  contractNumber: z.string().max(150).default(''),
  contractDate: z.string().default(''),
  assignmentNumber: z.string().max(150).default(''),
  assignmentDate: z.string().default(''),
  verified: z.boolean().default(false),
  requisites: z.record(z.string(), z.string()).default({}),
  notes: z.string().max(10000).default(''),
  mapping: z.record(z.string(), z.unknown()).default({}),
  rules: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  revision: z.number().int().optional(),
});
const period = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
const confirmations = z.object({
  claims: z.string().max(10000),
  intellectualProperty: z.string().max(10000),
  npd: z.boolean(),
  terms: z.boolean(),
  numberingBasis: z.string().max(1000),
  templateApproved: z.boolean(),
});
const documentSchema = z.object({
  calculationId: z.string(),
  actNumber: z.string().min(1).max(100),
  actDate: z.string(),
  draft: z.boolean().default(false),
  newVersion: z.boolean().default(false),
  confirmations,
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});
const sessionStore = pgSession(session);
const asyncRoute =
  (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
export async function getSettings() {
  const records = await db.setting.findMany();
  return Object.fromEntries(records.map((x) => [x.key, x.value]));
}
export async function saveCalculation(
  teacher: any,
  raw: unknown[][],
  source: any,
  month: number,
  year: number,
) {
  const adjustments = await db.adjustment.findMany({
    where: { teacherId: teacher.id, month, year },
    orderBy: { createdAt: 'asc' },
  });
  const report = calculate(raw, {
    month,
    year,
    rules: teacher.rules as Rules,
    mapping: teacher.mapping as Mapping,
    sourceUrl: source.url,
    rates: teacher.rates,
    adjustments,
  });
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teacher.id + year + month}))`;
    const last = await tx.calculation.findFirst({
      where: { teacherId: teacher.id, month, year },
      orderBy: { version: 'desc' },
    });
    return tx.calculation.create({
      data: {
        teacherId: teacher.id,
        month,
        year,
        version: (last?.version ?? 0) + 1,
        raw: json(raw),
        source: json({
          ...source,
          teacherRevision: teacher.revision,
          rules: teacher.rules,
          rates: teacher.rates,
          mapping: teacher.mapping,
          adjustments,
        }),
        report: json(report),
        hash: hash({ raw, report, rules: teacher.rules, teacherRevision: teacher.revision }),
      },
    });
  });
}
export function createApp() {
  const app = express();
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw Error('Нужен SESSION_SECRET не короче 32 символов');
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const usesHttps = process.env.APP_URL?.startsWith('https://') ?? false;
  app.use(
    helmet({
      strictTransportSecurity: usesHttps ? undefined : false,
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: usesHttps ? [] : null } },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  app.locals.close = () => pool.end();
  app.use(
    session({
      name: 'lomonosov.sid',
      secret: process.env.SESSION_SECRET,
      store: new sessionStore({ pool, createTableIfMissing: true }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.APP_URL?.startsWith('https://') ?? false,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      await db.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    }),
  );
  app.get(
    '/api/auth/session',
    asyncRoute(async (req, res) => {
      req.session.csrf ??= randomBytes(32).toString('hex');
      const user = req.session.userId
        ? await db.user.findUnique({
            where: { id: req.session.userId },
            select: { id: true, email: true, role: true, active: true },
          })
        : null;
      res
        .set('Cache-Control', 'no-store')
        .json({ user: user?.active ? user : null, csrf: req.session.csrf });
    }),
  );
  app.use(
    '/api',
    asyncRoute(async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const origin = req.get('origin');
      if (origin && origin !== new URL(process.env.APP_URL ?? 'http://localhost:3000').origin)
        return void res.status(403).json({ error: 'Недопустимый Origin' });
      const token = req.get('x-csrf-token') ?? '';
      const expected = req.session.csrf ?? '';
      if (
        !expected ||
        token.length !== expected.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
      )
        return void res.status(403).json({ error: 'Недействительный CSRF-токен' });
      next();
    }),
  );
  app.post(
    '/api/auth/login',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false }),
    asyncRoute(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user?.active || !(await bcrypt.compare(input.password, user.passwordHash)))
        return void res.status(401).json({ error: 'Неверная почта или пароль' });
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.userId = user.id;
      req.session.csrf = randomBytes(32).toString('hex');
      await audit(user.id, 'LOGIN', user.id);
      res.json({
        user: { id: user.id, email: user.email, role: user.role },
        csrf: req.session.csrf,
      });
    }),
  );
  app.use(
    '/api',
    asyncRoute(async (req, res, next) => {
      const user = req.session.userId
        ? await db.user.findUnique({ where: { id: req.session.userId } })
        : null;
      if (!user?.active) return void res.status(401).json({ error: 'Необходима авторизация' });
      res.locals.user = user;
      next();
    }),
  );
  app.post(
    '/api/auth/logout',
    asyncRoute(async (req, res) => {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      res.clearCookie('lomonosov.sid').json({ ok: true });
    }),
  );
  const admin: express.RequestHandler = (_req, res, next) =>
    res.locals.user.role === 'ADMIN'
      ? next()
      : void res.status(403).json({ error: 'Нужны права администратора' });
  app.get(
    '/api/teachers',
    asyncRoute(async (req, res) => {
      const q = String(req.query.q ?? '');
      res.json(
        await db.teacher.findMany({
          where: {
            archived: req.query.archived === 'true',
            name: { contains: q, mode: 'insensitive' },
          },
          include: { rates: true },
          orderBy: { name: 'asc' },
        }),
      );
    }),
  );
  app.post(
    '/api/teachers',
    admin,
    asyncRoute(async (req, res) => {
      const input = teacherSchema.parse(req.body);
      const { revision, ...data } = input;
      for (const k of ['contractDate', 'assignmentDate'] as const)
        if (data[k] && !dateISO(data[k])) throw Error(`Неверная дата: ${k}`);
      if (data.spreadsheetId) data.spreadsheetId = googleId(data.spreadsheetId);
      if (data.folderId) data.folderId = googleId(data.folderId);
      const teacher = await db.teacher.create({
        data: {
          ...data,
          mapping: json(data.mapping),
          rules: json(data.rules),
          requisites: json(data.requisites),
          protectedFields: json(Object.keys(data)),
        },
      });
      await audit(res.locals.user.id, 'TEACHER_CREATE', teacher.id);
      res.status(201).json(teacher);
    }),
  );
  app.put(
    '/api/teachers/:id',
    admin,
    asyncRoute(async (req, res) => {
      const input = teacherSchema.parse(req.body);
      const old = await db.teacher.findUniqueOrThrow({
        where: { id: String(req.params.id) },
        include: { rates: true },
      });
      if (input.revision !== old.revision)
        return void res
          .status(409)
          .json({ error: 'Карточка изменена другим пользователем. Обновите её.' });
      const { revision, ...data } = input;
      for (const k of ['contractDate', 'assignmentDate'] as const)
        if (data[k] && !dateISO(data[k])) throw Error(`Неверная дата: ${k}`);
      if (data.spreadsheetId) data.spreadsheetId = googleId(data.spreadsheetId);
      if (data.folderId) data.folderId = googleId(data.folderId);
      const protectedFields = Object.keys(data).filter(
        (k) => JSON.stringify((old as any)[k]) !== JSON.stringify((data as any)[k]),
      );
      const updated = await db.$transaction(async (tx) => {
        const changed = await tx.teacher.updateMany({
          where: { id: old.id, revision: old.revision },
          data: {
            ...data,
            mapping: json(data.mapping),
            rules: json(data.rules),
            requisites: json(data.requisites),
            revision: { increment: 1 },
            protectedFields: json([
              ...new Set([...(old.protectedFields as string[]), ...protectedFields]),
            ]),
          },
        });
        if (!changed.count) throw Error('Конфликт изменения карточки');
        await tx.audit.create({
          data: {
            userId: res.locals.user.id,
            action: 'TEACHER_UPDATE',
            entityId: old.id,
            data: json({ before: old, after: data }),
          },
        });
        return tx.teacher.findUniqueOrThrow({ where: { id: old.id } });
      });
      res.json(updated);
    }),
  );
  app.post(
    '/api/teachers/:id/rates',
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          from: z.string(),
          to: z.string().nullable(),
          service: z.enum(['INDIVIDUAL', 'GROUP']),
          format: z.string(),
          amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
          unitMinutes: z.number().int().positive(),
          confirmed: z.boolean(),
        })
        .parse(req.body);
      if (!dateISO(input.from) || (input.to && (!dateISO(input.to) || input.to < input.from)))
        throw Error('Неверный период ставки');
      const overlap = await db.rate.findFirst({
        where: {
          teacherId: String(req.params.id),
          service: input.service,
          format: input.format,
          from: { lte: input.to ?? '9999-12-31' },
          OR: [{ to: null }, { to: { gte: input.from } }],
        },
      });
      if (overlap) throw Error('Периоды ставок пересекаются');
      const rate = await db.rate.create({ data: { ...input, teacherId: String(req.params.id) } });
      await db.teacher.update({
        where: { id: String(req.params.id) },
        data: { revision: { increment: 1 } },
      });
      await audit(res.locals.user.id, 'RATE_CREATE', rate.id, input);
      res.status(201).json(rate);
    }),
  );
  app.post(
    '/api/directory/sync',
    admin,
    asyncRoute(async (_req, res) => {
      res.json(await syncDirectory(res.locals.user.id));
    }),
  );
  app.get(
    '/api/teachers/:id/calculations',
    asyncRoute(async (req, res) => {
      const p = period.parse(req.query);
      res.json(
        await db.calculation.findMany({
          where: { teacherId: String(req.params.id), ...p },
          orderBy: { version: 'desc' },
        }),
      );
    }),
  );
  app.post(
    '/api/teachers/:id/calculate',
    admin,
    asyncRoute(async (req, res) => {
      const p = period.parse(req.body);
      const teacher = await db.teacher.findUniqueOrThrow({
        where: { id: String(req.params.id) },
        include: { rates: true },
      });
      if (teacher.archived) throw Error('Преподаватель архивирован');
      if (!teacher.spreadsheetId) throw Error('У преподавателя нет расчётной таблицы');
      const source = await salary(teacher.spreadsheetId, p.month, p.year);
      const c = await saveCalculation(teacher, source.raw, source.source, p.month, p.year);
      await audit(res.locals.user.id, 'CALCULATE', c.id);
      res.status(201).json(c);
    }),
  );
  app.post(
    '/api/teachers/:id/import',
    admin,
    upload.single('file'),
    asyncRoute(async (req, res) => {
      const p = period.parse(req.body);
      if (!req.file) throw Error('Выберите файл XLSX или CSV');
      const ext = path.extname(req.file.originalname).toLowerCase();
      let raw: unknown[][];
      if (ext === '.xlsx') {
        const sheets = await readSheetNames(req.file.buffer);
        const title = monthKey(p.month, p.year);
        const sheet = sheets.find((s) => s === title) ?? (sheets.length === 1 ? sheets[0] : null);
        if (!sheet)
          throw Error(
            `В XLSX нет листа ${title}; выберите файл с одним листом или нужным месячным листом`,
          );
        raw = await readXlsxFile(req.file.buffer, { sheet });
        raw = raw.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)));
      } else if (ext === '.csv') {
        const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
        raw = parse(text, {
          delimiter: text.split('\n')[0].includes(';') ? ';' : ',',
          relax_column_count: true,
          skip_empty_lines: false,
        });
      } else throw Error('Поддерживаются только XLSX и CSV');
      if (raw.length > 20000 || raw.some((r) => r.length > 100))
        throw Error('Файл превышает допустимый размер таблицы');
      const teacher = await db.teacher.findUniqueOrThrow({
        where: { id: String(req.params.id) },
        include: { rates: true },
      });
      const result = await saveCalculation(
        teacher,
        raw,
        {
          kind: 'FILE',
          name: req.file.originalname,
          sha256: hash(req.file.buffer.toString('base64')),
          syncedAt: new Date().toISOString(),
        },
        p.month,
        p.year,
      );
      await audit(res.locals.user.id, 'FILE_IMPORT', result.id);
      res.status(201).json(result);
    }),
  );
  app.post(
    '/api/teachers/:id/adjustments',
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          month: z.number().int().min(1).max(12),
          year: z.number().int().min(2000).max(2100),
          type: z.enum(['BONUS', 'COMPENSATION', 'CORRECTION', 'FINE']),
          amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
          basis: z.string().trim().min(5).max(2000),
        })
        .parse(req.body);
      const teacher = await db.teacher.findUniqueOrThrow({
        where: { id: String(req.params.id) },
        include: { rates: true },
      });
      const adjustment = await db.adjustment.create({
        data: { ...input, teacherId: teacher.id, authorId: res.locals.user.id },
      });
      const last = await db.calculation.findFirst({
        where: { teacherId: teacher.id, month: input.month, year: input.year },
        orderBy: { version: 'desc' },
      });
      const calculation = last
        ? await saveCalculation(
            teacher,
            last.raw as unknown[][],
            last.source,
            input.month,
            input.year,
          )
        : null;
      await audit(res.locals.user.id, 'ADJUSTMENT_CREATE', adjustment.id, input);
      res.status(201).json({ adjustment, calculation });
    }),
  );
  app.get(
    '/api/settings',
    admin,
    asyncRoute(async (_req, res) => {
      res.json({
        settings: await getSettings(),
        accounts: await db.googleAccount.findMany({
          select: { id: true, email: true, active: true, updatedAt: true },
        }),
        googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
      });
    }),
  );
  app.put(
    '/api/settings/:key',
    admin,
    asyncRoute(async (req, res) => {
      const key = z.enum(['customer', 'numbering', 'backup', 'driveCopy']).parse(req.params.key);
      const value = z.record(z.string(), z.unknown()).parse(req.body);
      if (key === 'driveCopy' && value.enabled === true && value.transferApproved !== true)
        throw Error('Нужно подтвердить основания передачи данных в Google Drive');
      await db.setting.upsert({
        where: { key },
        create: { key, value: json(value) },
        update: { value: json(value) },
      });
      await audit(res.locals.user.id, 'SETTINGS_UPDATE', key, value);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/templates/import',
    admin,
    upload.single('file'),
    asyncRoute(async (req, res) => {
      const kind = z.enum(['NPD', 'IP']).parse(req.body.kind);
      const bytes =
        req.file?.buffer ??
        (await downloadDocx(
          googleId(String(req.body.driveId ?? process.env.TEMPLATE_DRIVE_ID ?? '')),
        ));
      if (bytes.length > 12 * 1024 * 1024 || bytes.subarray(0, 2).toString() !== 'PK')
        throw Error('Некорректный DOCX');
      const templateHash = hash(bytes.toString('base64'));
      const dir = path.join(storageRoot(), 'templates');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, templateHash + '.docx');
      await writeFile(file, bytes, { mode: 0o600 });
      const old =
        ((await db.setting.findUnique({ where: { key: 'template' } }))?.value as any) ?? {};
      const next = {
        ...old,
        [kind === 'IP' ? 'ipPath' : 'path']: file,
        [kind === 'IP' ? 'ipHash' : 'hash']: templateHash,
        approved: false,
        ipApproved: kind === 'IP' ? false : old.ipApproved,
        sourceDriveId: req.body.driveId ?? '',
      };
      await db.setting.upsert({
        where: { key: 'template' },
        create: { key: 'template', value: json(next) },
        update: { value: json(next) },
      });
      await audit(res.locals.user.id, 'TEMPLATE_IMPORT', templateHash, { kind });
      res.json(next);
    }),
  );
  app.post(
    '/api/templates/approve',
    admin,
    asyncRoute(async (req, res) => {
      const old = (await db.setting.findUniqueOrThrow({ where: { key: 'template' } })).value as any;
      const input = z
        .object({ hash: z.string(), kind: z.enum(['NPD', 'IP']), basis: z.string().min(10) })
        .parse(req.body);
      if (input.hash !== (input.kind === 'IP' ? old.ipHash : old.hash))
        throw Error('Версия шаблона изменилась');
      const next = {
        ...old,
        approved: input.kind === 'NPD' ? true : old.approved,
        ipApproved: input.kind === 'IP' ? true : old.ipApproved,
      };
      await db.setting.update({ where: { key: 'template' }, data: { value: json(next) } });
      await audit(res.locals.user.id, 'TEMPLATE_APPROVE', input.hash, input);
      res.json(next);
    }),
  );
  app.get(
    '/api/templates/:kind/download',
    admin,
    asyncRoute(async (req, res) => {
      const template = (await getSettings()).template as any;
      const file = req.params.kind === 'IP' ? template?.ipPath : template?.path;
      if (!file) throw Error('Шаблон не подключён');
      res.download(file, 'template.docx');
    }),
  );
  app.get(
    '/api/google/connect',
    admin,
    asyncRoute(async (req, res) => {
      const client = oauth();
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      req.session.oauthState = randomBytes(32).toString('hex');
      req.session.oauthVerifier = codeVerifier;
      const url = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state: req.session.oauthState,
        scope: [
          'openid',
          'email',
          'https://www.googleapis.com/auth/spreadsheets.readonly',
          'https://www.googleapis.com/auth/drive',
        ],
        code_challenge: codeChallenge,
        code_challenge_method: 'S256' as any,
      });
      req.session.save((e) =>
        e ? res.status(500).json({ error: 'Не удалось создать OAuth-сессию' }) : res.redirect(url),
      );
    }),
  );
  app.get(
    '/api/google/callback',
    admin,
    asyncRoute(async (req, res) => {
      const state = String(req.query.state ?? '');
      if (!req.session.oauthState || state !== req.session.oauthState)
        throw Error('Недействительное OAuth state');
      delete req.session.oauthState;
      const verifier = req.session.oauthVerifier;
      delete req.session.oauthVerifier;
      if (req.query.error) throw Error('Google-доступ отклонён');
      const client = oauth();
      const { tokens } = await client.getToken({
        code: String(req.query.code ?? ''),
        codeVerifier: verifier,
      });
      if (!tokens.refresh_token)
        throw Error('Google не вернул refresh token; повторите подключение с согласием');
      client.setCredentials(tokens);
      const profile = await (await import('googleapis')).google
        .oauth2({ version: 'v2', auth: client })
        .userinfo.get();
      if (!profile.data.email) throw Error('Google не вернул email');
      await db.googleAccount.upsert({
        where: { email: profile.data.email },
        create: { email: profile.data.email, tokens: json(tokens) },
        update: { tokens: json(tokens), active: true },
      });
      await audit(res.locals.user.id, 'GOOGLE_CONNECT', profile.data.email);
      if (!(await db.teacher.count())) await syncDirectory(res.locals.user.id);
      res.redirect('/?page=settings&connected=1');
    }),
  );
  app.delete(
    '/api/google/accounts/:id',
    admin,
    asyncRoute(async (req, res) => {
      await db.googleAccount.update({
        where: { id: String(req.params.id) },
        data: { active: false, tokens: {} },
      });
      await audit(res.locals.user.id, 'GOOGLE_DISCONNECT', String(req.params.id));
      res.json({ ok: true });
    }),
  );
  const documentContext = async (input: z.infer<typeof documentSchema>) => {
    const calculation = await db.calculation.findUniqueOrThrow({
      where: { id: input.calculationId },
      include: { teacher: { include: { rates: true } } },
    });
    const settings = await getSettings();
    const teacher = calculation.teacher;
    const report = calculation.report as unknown as Report;
    const errors = preflight(teacher, report, input, settings);
    const last = await db.calculation.findFirst({
      where: { teacherId: teacher.id, month: calculation.month, year: calculation.year },
      orderBy: { version: 'desc' },
    });
    if (last?.id !== calculation.id) errors.push('Есть более новая версия расчёта');
    if ((calculation.source as any).teacherRevision !== teacher.revision)
      errors.push('Карточка или правила изменены: обновите расчёт');
    if (
      input.actDate <
      new Date(Date.UTC(calculation.year, calculation.month, 0)).toISOString().slice(0, 10)
    )
      errors.push('Дата акта раньше окончания периода');
    if (teacher.kind === 'IP' && !(settings.template as any)?.ipApproved)
      errors.push('Шаблон ИП не подтверждён');
    return { calculation, settings, teacher, report, errors };
  };
  app.post(
    '/api/documents/preflight',
    asyncRoute(async (req, res) => {
      const input = documentSchema.parse(req.body);
      const context = await documentContext(input);
      res.json({
        errors: context.errors,
        canFinalize: context.errors.length === 0,
        existing: await db.document.findMany({
          where: {
            calculation: {
              teacherId: context.teacher.id,
              month: context.calculation.month,
              year: context.calculation.year,
            },
          },
          select: { id: true, version: true, actNumber: true, status: true },
        }),
      });
    }),
  );
  app.post(
    '/api/documents',
    admin,
    rateLimit({ windowMs: 60 * 1000, limit: 10 }),
    asyncRoute(async (req, res) => {
      const input = documentSchema.parse(req.body);
      const c = await documentContext(input);
      if (c.errors.length && !input.draft)
        return void res.status(422).json({ error: 'Проверка не пройдена', errors: c.errors });
      const template = c.settings.template as any;
      const templatePath = c.teacher.kind === 'IP' ? template?.ipPath : template?.path;
      if (!templatePath) throw Error('Сначала загрузите исходный шаблон DOCX');
      const templateBytes = await readFile(templatePath);
      const templateHash = hash(templateBytes.toString('base64'));
      if (templateHash !== (c.teacher.kind === 'IP' ? template.ipHash : template.hash))
        throw Error('Контрольная сумма шаблона изменилась');
      const document = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.teacher.id}))`;
          const existing = await tx.document.findMany({
            where: {
              calculation: {
                teacherId: c.teacher.id,
                month: c.calculation.month,
                year: c.calculation.year,
              },
            },
            orderBy: { version: 'desc' },
          });
          if (existing.length && !input.newVersion)
            throw Object.assign(
              Error('Акт за период уже существует. Подтвердите создание новой версии.'),
              { status: 409 },
            );
          if (existing.length && existing[0].actNumber !== input.actNumber)
            throw Error('Для новой версии сохраните номер акта за период');
          const duplicate = await tx.document.findFirst({
            where: {
              actNumber: input.actNumber,
              calculation: {
                teacherId: c.teacher.id,
                NOT: { month: c.calculation.month, year: c.calculation.year },
              },
            },
          });
          if (duplicate)
            throw Error('Этот номер акта уже используется у преподавателя за другой период');
          const doc = await tx.document.create({
            data: {
              calculationId: c.calculation.id,
              version: (existing[0]?.version ?? 0) + 1,
              actNumber: input.actNumber,
              actDate: input.actDate,
              status: 'DRAFT',
              amount: c.report.total,
              snapshot: json({
                teacher: c.teacher,
                source: c.calculation.source,
                report: c.report,
                customer: c.settings.customer,
                errors: c.errors,
                draft: input.draft,
                processing: 'GENERATING',
              }),
              confirmations: json(input.confirmations),
              templateHash,
            },
          });
          return doc;
        },
        { timeout: 15000 },
      );
      try {
        const docx = renderDocx(templateBytes, {
          teacher: c.teacher,
          report: c.report,
          source: c.calculation.source,
          month: c.calculation.month,
          year: c.calculation.year,
          actNumber: input.actNumber,
          actDate: input.actDate,
          confirmations: input.confirmations,
          draft: input.draft,
          errors: c.errors,
          calculationId: c.calculation.id,
          version: c.calculation.version,
          customer: c.settings.customer,
        });
        const pdf = await convertDocx(docx);
        const files = await saveDocument(docx, pdf);
        let driveId = '',
          uploadError = '';
        const driveCopy = c.settings.driveCopy as any;
        if (driveCopy?.enabled && driveCopy.transferApproved && c.teacher.folderId) {
          try {
            const result = await uploadPdf(
              c.teacher.folderId,
              `Акт ${input.actNumber} v${document.version}.pdf`,
              pdf,
            );
            driveId = result.id ?? '';
          } catch {
            uploadError = 'Копия Google Drive не сохранена. Повторите загрузку из истории.';
          }
        } else
          uploadError =
            'Копирование в Google Drive отключено; включите в настройках после подтверждения оснований передачи данных';
        const result = await db.document.update({
          where: { id: document.id },
          data: { ...files, driveId, uploadError, status: input.draft ? 'DRAFT' : 'READY' },
        });
        await audit(res.locals.user.id, 'DOCUMENT_CREATE', result.id, {
          calculationId: c.calculation.id,
          version: document.version,
          errors: c.errors,
        });
        res.status(201).json(result);
      } catch (error) {
        await db.document.update({
          where: { id: document.id },
          data: {
            status: 'CORRECTION',
            uploadError: 'Генерация не завершена; создайте новую версию после устранения ошибки',
          },
        });
        throw error;
      }
    }),
  );
  app.get(
    '/api/documents',
    asyncRoute(async (req, res) => {
      res.json(
        await db.document.findMany({
          where: req.query.teacherId
            ? { calculation: { teacherId: String(req.query.teacherId) } }
            : {},
          include: {
            calculation: {
              select: {
                teacher: { select: { name: true } },
                month: true,
                year: true,
                version: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
      );
    }),
  );
  app.get(
    '/api/documents/:id/:format',
    asyncRoute(async (req, res) => {
      const d = await db.document.findUniqueOrThrow({ where: { id: String(req.params.id) } });
      const file =
        req.params.format === 'pdf' ? d.pdfPath : req.params.format === 'docx' ? d.docxPath : '';
      if (!file) return void res.status(404).json({ error: 'Документ ещё не создан' });
      await audit(res.locals.user.id, 'DOCUMENT_DOWNLOAD', d.id, { format: req.params.format });
      res.download(file, `act-v${d.version}.${req.params.format === 'pdf' ? 'pdf' : 'docx'}`);
    }),
  );
  app.patch(
    '/api/documents/:id/status',
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          status: z.enum(['DRAFT', 'REVIEW', 'READY', 'SIGNED', 'CORRECTION']),
          basis: z.string().trim().min(5),
        })
        .parse(req.body);
      const old = await db.document.findUniqueOrThrow({ where: { id: String(req.params.id) } });
      if (['READY', 'SIGNED'].includes(input.status)) {
        if ((old.snapshot as any).errors?.length || (old.snapshot as any).draft || !old.pdfPath)
          throw Error('Документ с ошибками нельзя перевести в готовый или подписанный');
        if (old.status === 'DRAFT') throw Error('Черновик нужно пересоздать как финальный PDF');
      }
      const doc = await db.document.update({
        where: { id: old.id },
        data: { status: input.status },
      });
      await audit(res.locals.user.id, 'DOCUMENT_STATUS', old.id, { from: old.status, ...input });
      res.json(doc);
    }),
  );
  app.post(
    '/api/documents/:id/drive',
    admin,
    asyncRoute(async (req, res) => {
      const settings = await getSettings();
      if (!(settings.driveCopy as any)?.enabled || !(settings.driveCopy as any)?.transferApproved)
        throw Error('Копирование в Google Drive не разрешено');
      const d = await db.document.findUniqueOrThrow({
        where: { id: String(req.params.id) },
        include: { calculation: { include: { teacher: true } } },
      });
      if (d.driveId) return void res.json(d);
      if (!d.pdfPath) throw Error('PDF отсутствует');
      const folder = d.calculation.teacher.folderId;
      if (!folder) throw Error('Не заполнена папка преподавателя');
      const upload = await uploadPdf(
        folder,
        `Акт ${d.actNumber} v${d.version}.pdf`,
        await readFile(d.pdfPath),
      );
      const result = await db.document.update({
        where: { id: d.id },
        data: { driveId: upload.id ?? '', uploadError: '' },
      });
      await audit(res.locals.user.id, 'DRIVE_UPLOAD', d.id);
      res.json(result);
    }),
  );
  app.get(
    '/api/users',
    admin,
    asyncRoute(async (_req, res) => {
      res.json(
        await db.user.findMany({
          select: { id: true, email: true, role: true, active: true, createdAt: true },
        }),
      );
    }),
  );
  app.post(
    '/api/users',
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          email: z.email(),
          password: z.string().min(14).max(200),
          role: z.enum(['ADMIN', 'EMPLOYEE']),
        })
        .parse(req.body);
      const user = await db.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: await bcrypt.hash(input.password, 12),
          role: input.role,
        },
        select: { id: true, email: true, role: true },
      });
      await audit(res.locals.user.id, 'USER_CREATE', user.id);
      res.status(201).json(user);
    }),
  );
  app.patch(
    '/api/users/:id',
    admin,
    asyncRoute(async (req, res) => {
      const input = z
        .object({ active: z.boolean(), role: z.enum(['ADMIN', 'EMPLOYEE']) })
        .parse(req.body);
      if (req.params.id === res.locals.user.id && (!input.active || input.role !== 'ADMIN'))
        throw Error('Нельзя отключить собственный административный доступ');
      const user = await db.user.update({
        where: { id: String(req.params.id) },
        data: input,
        select: { id: true, email: true, role: true, active: true },
      });
      await audit(res.locals.user.id, 'USER_UPDATE', user.id, input);
      res.json(user);
    }),
  );
  app.get(
    '/api/audit',
    admin,
    asyncRoute(async (req, res) => {
      res.json(
        await db.audit.findMany({
          where: req.query.entityId ? { entityId: String(req.query.entityId) } : {},
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
      );
    }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден' }));
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError)
      return void res.status(400).json({
        error: 'Некорректные данные',
        errors: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const status = err.status ?? (err.code === 'P2025' ? 404 : err.code === 'P2002' ? 409 : 400);
    res.status(status).json({
      error:
        err.code === 'P2002'
          ? 'Запись с такими данными уже существует'
          : (err.message ?? 'Ошибка сервера'),
    });
  });
  return app;
}
