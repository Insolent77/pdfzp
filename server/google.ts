import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { db, json } from './db';
import { monthKey, norm, dateISO } from './calculation';
export function oauth() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    throw Error('Google OAuth не настроен на сервере');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}
export async function googleClient() {
  const account = await db.googleAccount.findFirst({
    where: { active: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!account) throw Error('Подключите Google-аккаунт в настройках');
  const client = oauth();
  let tokens = account.tokens as {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
  };
  client.setCredentials(tokens);
  client.on('tokens', async (next) => {
    try {
      tokens = { ...tokens, ...next } as typeof tokens;
      await db.googleAccount.update({
        where: { id: account.id },
        data: { tokens: json(tokens) },
      });
    } catch {
      console.error('Не удалось сохранить обновление Google-токена');
    }
  });
  return client;
}
export const googleId = (value: string) => {
  const id = value.match(/\/d\/([\w-]+)/)?.[1] ?? value.match(/\/folders\/([\w-]+)/)?.[1] ?? value;
  if (!/^[\w-]{10,150}$/.test(id)) throw Error('Неверная ссылка или Google ID');
  return id;
};
export async function salary(spreadsheetId: string, month: number, year: number) {
  const auth = await googleClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const title = monthKey(month, year);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties(title),sheets(properties)',
  });
  const tab = meta.data.sheets?.find((x) => x.properties?.title?.trim() === title);
  if (!tab) throw Error(`В таблице отсутствует вкладка «${title}»`);
  if ((tab.properties?.gridProperties?.rowCount ?? 0) > 20000)
    throw Error('Лист слишком большой: настройте отдельный диапазон');
  const actual = tab.properties!.title!;
  const rows = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${actual.replace(/'/g, "''")}'!A1:AZ${tab.properties?.gridProperties?.rowCount ?? 2500}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return {
    raw: rows.data.values ?? [],
    source: {
      kind: 'GOOGLE',
      spreadsheetId,
      title: meta.data.properties?.title,
      tab: actual,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${tab.properties!.sheetId}`,
      syncedAt: new Date().toISOString(),
    },
  };
}
export async function directoryRows() {
  const auth = await googleClient();
  const id = process.env.DIRECTORY_SPREADSHEET_ID;
  if (!id) throw Error('Не задан DIRECTORY_SPREADSHEET_ID');
  const result = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({
    spreadsheetId: id,
    range: "'Преподаватели'!A1:AZ600",
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return result.data.values ?? [];
}
export function parseDirectory(rows: unknown[][]) {
  const headers = (rows[0] ?? []).map((x) => norm(x).toLowerCase());
  const col = (...names: string[]) => headers.findIndex((x) => names.includes(x));
  return rows
    .slice(1)
    .filter((r) => norm(r[col('фио преподавателя', 'фио')]))
    .map((r, index) => {
      const get = (...names: string[]) => norm(r[col(...names)]);
      const contract = get('договор №', 'номер договора');
      const sheet = get('расчётная таблица', 'расчетная таблица');
      const folder = get('папка с договорами');
      return {
        name: get('фио преподавателя', 'фио'),
        spreadsheetId: sheet ? googleId(sheet) : '',
        folderId: folder ? googleId(folder) : '',
        contractNumber: contract,
        contractDate: dateISO(get('дата договора')),
        assignmentNumber: get('задание №'),
        assignmentDate: dateISO(get('дата задания')),
        kind: contract.startsWith('ИП') ? 'IP' : contract.startsWith('СМЗ') ? 'NPD' : 'UNKNOWN',
        notes: get('контроль данных'),
        sourceSnapshot: { row: index + 2, values: r },
        verified: false,
      };
    });
}
export async function syncDirectory(userId: string) {
  const { audit, json } = await import('./db');
  const parsed = parseDirectory(await directoryRows());
  let created = 0,
    updated = 0;
  const conflicts: unknown[] = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(9152201)`;
    for (const incoming of parsed) {
      const old = await tx.teacher.findUnique({ where: { name: incoming.name } });
      if (!old) {
        await tx.teacher.create({
          data: { ...incoming, sourceSnapshot: json(incoming.sourceSnapshot) },
        });
        created++;
        continue;
      }
      const protectedFields = new Set(old.protectedFields as string[]);
      const patch: Record<string, unknown> = { sourceSnapshot: incoming.sourceSnapshot };
      for (const [key, value] of Object.entries(incoming)) {
        if (['name', 'sourceSnapshot', 'verified'].includes(key)) continue;
        if ((old as any)[key] === value) continue;
        if (old.verified || protectedFields.has(key)) {
          conflicts.push({
            teacherId: old.id,
            field: key,
            existing: (old as any)[key],
            incoming: value,
          });
        } else if (value !== '') patch[key] = value;
      }
      await tx.teacher.update({
        where: { id: old.id },
        data: { ...(patch as any), revision: { increment: 1 } },
      });
      updated++;
    }
    await tx.audit.create({
      data: {
        userId,
        action: 'DIRECTORY_SYNC',
        entityId: 'directory',
        data: json({ created, updated, conflicts }),
      },
    });
  });
  return { created, updated, conflicts };
}
export async function downloadDocx(id: string) {
  const auth = await googleClient();
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId: id, fields: 'mimeType,name' });
  const result =
    meta.data.mimeType === 'application/vnd.google-apps.document'
      ? await drive.files.export(
          {
            fileId: id,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { responseType: 'arraybuffer' },
        )
      : await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(result.data as ArrayBuffer);
}
export async function uploadPdf(folderId: string, name: string, bytes: Buffer) {
  const auth = await googleClient();
  const result = await google.drive({ version: 'v3', auth }).files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType: 'application/pdf', body: Readable.from(bytes) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  return result.data;
}
