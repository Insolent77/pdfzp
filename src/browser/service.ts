import { calculate, dateISO, monthKey, money, number, type Report } from '../../shared/calculation';
import { preflight } from '../../shared/document-core';
import { renderDocx } from '../../shared/docx';
import { parse } from 'csv-parse/browser/esm/sync';
import readXlsxFile, { readSheetNames } from 'read-excel-file';
import {
  all,
  get,
  put,
  setting,
  setSetting,
  record,
  uid,
  checksum,
  withStore,
  download,
} from './storage';
import {
  accounts,
  config,
  connected,
  disconnectGoogle,
  templateBytes,
  idFromLink,
  readTab,
  uploadPdf,
} from './google';
import { syncTeachers, compareSummary } from './sources';
import { createPdf } from './pdf';
const now = () => new Date().toISOString();
const required = async (store: Parameters<typeof get>[0], id: string) => {
  const value = await get(store, id);
  if (!value) throw Error('Запись не найдена');
  return value;
};
const period = (body: any) => {
  const month = Number(body.month),
    year = Number(body.year);
  monthKey(month, year);
  return { month, year };
};
async function settings() {
  return {
    customer: await setting('customer'),
    template: await setting('template'),
    driveCopy: await setting('driveCopy', { enabled: true }),
    sources: await config(),
  };
}
async function saveCalculation(
  teacher: any,
  raw: unknown[][],
  source: any,
  month: number,
  year: number,
  summary?: any,
  warnings: string[] = [],
) {
  const adjustments = (await all('adjustments')).filter(
    (a) => a.teacherId === teacher.id && a.month === month && a.year === year,
  );
  const report = calculate(raw, {
    month,
    year,
    rules: teacher.rules,
    mapping: teacher.mapping,
    rates: teacher.rates,
    sourceUrl: source.url,
    adjustments,
  });
  report.warnings.push(...warnings);
  if (summary) {
    const sourceTotal = number(summary.values['Всего к выплате, ₽']);
    const detailedSource = number(report.sourceTotal ?? report.total)!;
    if (sourceTotal && sourceTotal.minus(detailedSource).abs().gte('.01'))
      report.errors.push(
        `Сводный лист: расхождение с итогом детализации ${money(detailedSource.minus(sourceTotal))} ₽`,
      );
    const difference = number(summary.values['Разница сверки, ₽']);
    if (difference && !difference.isZero())
      report.errors.push(`В сводном листе есть расхождение ${money(difference)} ₽`);
    report.reconciled = report.errors.length === 0;
  }
  const input = {
    teacherId: teacher.id,
    month,
    year,
    raw,
    source: {
      ...source,
      teacherRevision: teacher.revision,
      rules: teacher.rules,
      rates: teacher.rates,
      mapping: teacher.mapping,
      summary,
      adjustments,
    },
    report,
    hash: await checksum({ raw, report, teacherRevision: teacher.revision }),
    createdAt: now(),
  };
  return withStore('calculations', async (store) => {
    const old = (await store.getAll()).filter(
      (c: any) => c.teacherId === teacher.id && c.month === month && c.year === year,
    );
    const result = {
      ...input,
      id: uid(),
      version: Math.max(0, ...old.map((c: any) => c.version)) + 1,
    };
    await store.put(result);
    await record('CALCULATE', result.id);
    return result;
  });
}
async function context(body: any) {
  const calculation = await required('calculations', body.calculationId);
  const teacher = await required('teachers', calculation.teacherId);
  const cfg = await settings();
  const report = calculation.report as Report;
  const errors = preflight(teacher, report, body, cfg);
  const latest = (await all('calculations'))
    .filter(
      (c) =>
        c.teacherId === teacher.id && c.month === calculation.month && c.year === calculation.year,
    )
    .sort((a, b) => b.version - a.version)[0];
  if (latest.id !== calculation.id) errors.push('Есть более новая версия расчёта');
  if (calculation.source.teacherRevision !== teacher.revision)
    errors.push('Карточка или условия изменены. Обновите расчёт.');
  if (!dateISO(body.actDate)) errors.push('Неверная дата акта');
  if (
    body.actDate <
    new Date(Date.UTC(calculation.year, calculation.month, 0)).toISOString().slice(0, 10)
  )
    errors.push('Дата акта раньше окончания периода');
  const existing = (await all('documents')).filter(
    (d) =>
      d.teacherId === teacher.id && d.month === calculation.month && d.year === calculation.year,
  );
  return { calculation, teacher, cfg, report, errors, existing };
}
export async function downloadDocument(id: string, format: 'pdf' | 'docx') {
  const doc = await required('documents', id);
  const bytes = doc[format === 'pdf' ? 'pdfBytes' : 'docxBytes'];
  if (!bytes) throw Error('Документ ещё не создан');
  download(
    bytes,
    `Акт-${doc.actNumber}-v${doc.version}.${format}`,
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await record('DOCUMENT_DOWNLOAD', id, { format });
}
export async function downloadTemplate(kind: string) {
  const t = await setting('template');
  const bytes = t[kind === 'IP' ? 'ipBytes' : 'bytes'];
  if (!bytes) throw Error('Шаблон не загружен');
  download(bytes, 'template.docx');
}
function omitFiles(d: any) {
  const { pdfBytes, docxBytes, ...rest } = d;
  return rest;
}
export async function browserAction(route: string, method = 'GET', input?: any): Promise<any> {
  const url = new URL(route, 'https://local.invalid');
  const pathname = url.pathname;
  const body = input instanceof FormData ? Object.fromEntries(input.entries()) : (input ?? {});
  const parts = pathname.split('/').filter(Boolean);
  if (pathname === '/auth/session')
    return {
      user: { id: 'local-workspace', email: 'Данные этого браузера', role: 'ADMIN' },
      csrf: '',
    };
  if (pathname === '/auth/logout') {
    disconnectGoogle();
    return { ok: true };
  }
  if (pathname === '/settings' && method === 'GET')
    return {
      settings: await settings(),
      accounts: accounts(),
      googleConfigured: !!(await config()).clientId,
      browserMode: true,
    };
  if (parts[0] === 'settings' && method === 'PUT') {
    await setSetting(parts[1], body);
    await record('SETTINGS_UPDATE', parts[1]);
    return { ok: true };
  }
  if (pathname === '/directory/sync') return syncTeachers();
  if (parts[0] === 'google' && method === 'DELETE') {
    disconnectGoogle();
    await record('GOOGLE_DISCONNECT', 'google');
    return { ok: true };
  }
  if (pathname === '/teachers' && method === 'GET') {
    return (await all('teachers'))
      .filter((t) => !!t.archived === (url.searchParams.get('archived') === 'true'))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  if (parts[0] === 'teachers' && parts.length <= 2 && ['POST', 'PUT'].includes(method)) {
    if (!body.name?.trim()) throw Error('Укажите ФИО преподавателя');
    for (const key of ['contractDate', 'assignmentDate'])
      if (body[key] && !dateISO(body[key])) throw Error(`Некорректная дата: ${key}`);
    const duplicate = (await all('teachers')).find(
      (t) => t.name === body.name && t.id !== parts[1],
    );
    if (duplicate) throw Error('Преподаватель с таким ФИО уже существует');
    if (body.spreadsheetId) body.spreadsheetId = idFromLink(body.spreadsheetId);
    if (body.folderId) body.folderId = idFromLink(body.folderId);
    const teacher = await withStore('teachers', async (store) => {
      const old = parts[1] ? await store.get(parts[1]) : null;
      if (parts[1] && !old) throw Error('Карточка не найдена');
      if (old && old.revision !== body.revision)
        throw Error('Карточка изменена в другом окне. Обновите страницу.');
      const protectedFields = Object.keys(body).filter(
        (key) =>
          !['id', 'revision', 'rates', 'summary', 'sourceSnapshot', 'protectedFields'].includes(
            key,
          ) && JSON.stringify(body[key]) !== JSON.stringify(old?.[key]),
      );
      const result = {
        requisites: {},
        rules: {},
        mapping: {},
        rates: [],
        archived: false,
        ...old,
        ...body,
        id: old?.id ?? uid(),
        revision: (old?.revision ?? 0) + 1,
        protectedFields: [...new Set([...(old?.protectedFields ?? []), ...protectedFields])],
        updatedAt: now(),
      };
      await store.put(result);
      return result;
    });
    await record('TEACHER_UPDATE', teacher.id);
    return teacher;
  }
  if (parts[0] === 'teachers' && parts[2] === 'rates') {
    const teacher = await required('teachers', parts[1]);
    if (
      !dateISO(body.from) ||
      (body.to && (!dateISO(body.to) || body.to < body.from)) ||
      !number(body.amount) ||
      Number(body.unitMinutes) <= 0
    )
      throw Error('Проверьте ставку и период её действия');
    if (
      teacher.rates.some(
        (r: any) =>
          r.service === body.service &&
          r.format === body.format &&
          r.from <= (body.to || '9999-12-31') &&
          (!r.to || r.to >= body.from),
      )
    )
      throw Error('Периоды ставок пересекаются');
    const rate = { ...body, id: uid() };
    teacher.rates.push(rate);
    teacher.revision++;
    await put('teachers', teacher);
    await record('RATE_CREATE', rate.id);
    return rate;
  }
  if (parts[0] === 'teachers' && parts[2] === 'calculations') {
    const p = period(Object.fromEntries(url.searchParams));
    return (await all('calculations'))
      .filter((c) => c.teacherId === parts[1] && c.month === p.month && c.year === p.year)
      .sort((a, b) => b.version - a.version);
  }
  if (parts[0] === 'teachers' && parts[2] === 'calculate') {
    const p = period(body);
    const teacher = await required('teachers', parts[1]);
    if (teacher.archived) throw Error('Преподаватель архивирован');
    const previous = (await all('calculations'))
      .filter((c) => c.teacherId === teacher.id && c.month === p.month && c.year === p.year)
      .sort((a, b) => b.version - a.version)[0];
    if (previous?.source.kind === 'FILE' && (!teacher.spreadsheetId || !connected()))
      return saveCalculation(teacher, previous.raw, previous.source, p.month, p.year);
    if (!teacher.spreadsheetId) throw Error('В карточке нет ссылки на зарплатную таблицу');
    const source = await readTab(teacher.spreadsheetId, monthKey(p.month, p.year));
    let summary: any = null;
    let warnings: string[] = [];
    try {
      const comparison = await compareSummary(teacher.name, monthKey(p.month, p.year));
      summary = comparison.summary;
      warnings = comparison.warnings;
    } catch (e) {
      warnings.push('Сводный лист не прочитан: ' + (e as Error).message);
    }
    return saveCalculation(teacher, source.raw, source.source, p.month, p.year, summary, warnings);
  }
  if (parts[0] === 'teachers' && parts[2] === 'import') {
    const p = period(body);
    const file = body.file as File;
    if (!file || file.size > 12 * 1024 * 1024)
      throw Error('Выберите файл XLSX/CSV размером до 12 МБ');
    let raw: unknown[][];
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const sheets = await readSheetNames(file);
      const sheet =
        sheets.find((s) => s === monthKey(p.month, p.year)) ??
        (sheets.length === 1 ? sheets[0] : null);
      if (!sheet) throw Error('Не найден лист выбранного месяца');
      raw = (await readXlsxFile(file, { sheet })).map((r) =>
        r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
      );
    } else if (file.name.toLowerCase().endsWith('.csv')) {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      raw = parse(text, {
        delimiter: text.split('\n')[0].includes(';') ? ';' : ',',
        relax_column_count: true,
      });
    } else throw Error('Поддерживаются XLSX и CSV');
    if (raw.length > 20000) throw Error('В файле больше 20 000 строк');
    const teacher = await required('teachers', parts[1]);
    return saveCalculation(
      teacher,
      raw,
      {
        kind: 'FILE',
        name: file.name,
        sha256: await checksum(new Uint8Array(await file.arrayBuffer())),
        syncedAt: now(),
      },
      p.month,
      p.year,
    );
  }
  if (parts[0] === 'teachers' && parts[2] === 'adjustments') {
    const p = period(body);
    if (
      !['BONUS', 'COMPENSATION', 'CORRECTION', 'FINE'].includes(body.type) ||
      !number(body.amount) ||
      !body.basis?.trim() ||
      body.basis.trim().length < 5
    )
      throw Error('Укажите вид, числовую сумму и основание от 5 символов');
    const teacher = await required('teachers', parts[1]);
    const adjustment = {
      ...body,
      ...p,
      id: uid(),
      teacherId: teacher.id,
      authorId: 'local-workspace',
      createdAt: now(),
    };
    await put('adjustments', adjustment);
    await record('ADJUSTMENT_CREATE', adjustment.id, adjustment);
    const last = (await all('calculations'))
      .filter((c) => c.teacherId === teacher.id && c.month === p.month && c.year === p.year)
      .sort((a, b) => b.version - a.version)[0];
    return {
      adjustment,
      calculation: last
        ? await saveCalculation(
            teacher,
            last.raw,
            last.source,
            p.month,
            p.year,
            last.source.summary,
          )
        : null,
    };
  }
  if (pathname === '/templates/import') {
    const kind = body.kind === 'IP' ? 'IP' : 'NPD';
    const file = body.file as File | undefined;
    const bytes = file?.size
      ? new Uint8Array(await file.arrayBuffer())
      : await templateBytes(idFromLink(String(body.driveId || (await config()).templateId)));
    if (bytes.length > 12 * 1024 * 1024 || bytes[0] !== 80 || bytes[1] !== 75)
      throw Error('Не удалось прочитать DOCX');
    const hash = await checksum(bytes);
    const old = await setting('template');
    const next = {
      ...old,
      ...(kind === 'IP'
        ? { ipPath: 'indexeddb', ipBytes: bytes.buffer, ipHash: hash, ipApproved: false }
        : { path: 'indexeddb', bytes: bytes.buffer, hash, approved: false }),
    };
    await setSetting('template', next);
    await record('TEMPLATE_IMPORT', hash, { kind });
    return { ...next, bytes: undefined, ipBytes: undefined };
  }
  if (pathname === '/templates/approve') {
    const cfg = await setting('template');
    if (body.hash !== cfg[body.kind === 'IP' ? 'ipHash' : 'hash'] || body.basis?.length < 10)
      throw Error('Версия шаблона изменилась или не заполнено основание проверки');
    cfg[body.kind === 'IP' ? 'ipApproved' : 'approved'] = true;
    await setSetting('template', cfg);
    await record('TEMPLATE_APPROVE', body.hash, { kind: body.kind, basis: body.basis });
    return cfg;
  }
  if (pathname === '/documents/preflight') {
    const c = await context(body);
    return {
      errors: c.errors,
      canFinalize: c.errors.length === 0,
      existing: c.existing.map(omitFiles),
    };
  }
  if (pathname === '/documents' && method === 'POST') {
    const c = await context(body);
    if (c.errors.length && !body.draft)
      throw Error('Проверка не пройдена:\n' + c.errors.join('\n'));
    const template = c.cfg.template;
    const bytes = template[c.teacher.kind === 'IP' ? 'ipBytes' : 'bytes'];
    if (!bytes) throw Error('Импортируйте исходный DOCX-шаблон в настройках');
    if (
      (await checksum(new Uint8Array(bytes))) !==
      template[c.teacher.kind === 'IP' ? 'ipHash' : 'hash']
    )
      throw Error('Контрольная сумма шаблона изменилась');
    const doc = await withStore('documents', async (store) => {
      const allDocs = await store.getAll();
      const existing = allDocs
        .filter(
          (d: any) =>
            d.teacherId === c.teacher.id &&
            d.month === c.calculation.month &&
            d.year === c.calculation.year,
        )
        .sort((a: any, b: any) => b.version - a.version);
      if (existing.length && !body.newVersion)
        throw Error('Акт за период уже есть. Подтвердите создание новой версии.');
      if (existing.length && existing[0].actNumber !== body.actNumber)
        throw Error('Для новой версии сохраните номер акта');
      if (
        allDocs.some(
          (d: any) =>
            d.teacherId === c.teacher.id &&
            d.actNumber === body.actNumber &&
            (d.month !== c.calculation.month || d.year !== c.calculation.year),
        )
      )
        throw Error('Номер акта уже используется за другой период');
      const next = {
        id: uid(),
        teacherId: c.teacher.id,
        month: c.calculation.month,
        year: c.calculation.year,
        calculationId: c.calculation.id,
        version: (existing[0]?.version ?? 0) + 1,
        actNumber: body.actNumber,
        actDate: body.actDate,
        amount: c.report.total,
        createdAt: now(),
        status: 'DRAFT',
        templateHash: template[c.teacher.kind === 'IP' ? 'ipHash' : 'hash'],
        snapshot: {
          teacher: c.teacher,
          source: c.calculation.source,
          report: c.report,
          customer: c.cfg.customer,
          errors: c.errors,
          draft: !!body.draft,
        },
        confirmations: body.confirmations,
        driveId: '',
        uploadError: '',
        pdfPath: '',
        docxPath: '',
      };
      await store.put(next);
      return next;
    });
    try {
      const docx = renderDocx(new Uint8Array(bytes), {
        teacher: c.teacher,
        report: c.report,
        source: c.calculation.source,
        month: c.calculation.month,
        year: c.calculation.year,
        actNumber: body.actNumber,
        actDate: body.actDate,
        confirmations: body.confirmations,
        draft: !!body.draft,
        errors: c.errors,
        calculationId: c.calculation.id,
        version: c.calculation.version,
        customer: c.cfg.customer,
      });
      const pdf = await createPdf(docx);
      Object.assign(doc, {
        pdfBytes: new Uint8Array(pdf).buffer,
        docxBytes: new Uint8Array(docx).buffer,
        pdfPath: 'indexeddb',
        docxPath: 'indexeddb',
        status: body.draft ? 'DRAFT' : 'READY',
      });
      await put('documents', doc);
      if (c.cfg.driveCopy.enabled && c.teacher.folderId) {
        try {
          const file = await uploadPdf(
            c.teacher.folderId,
            `Акт ${doc.actNumber} v${doc.version}.pdf`,
            pdf,
          );
          doc.driveId = file.id;
        } catch (e) {
          doc.uploadError = 'PDF сохранён на устройстве; Google Drive: ' + (e as Error).message;
        }
      } else doc.uploadError = 'Автокопирование Google Drive выключено либо не задана папка';
      await put('documents', doc);
      await record('DOCUMENT_CREATE', doc.id, {
        calculationId: c.calculation.id,
        version: doc.version,
      });
      return omitFiles(doc);
    } catch (error) {
      await put('documents', {
        ...doc,
        status: 'CORRECTION',
        uploadError: (error as Error).message,
      });
      throw error;
    }
  }
  if (pathname === '/documents' && method === 'GET') {
    const teachers = await all('teachers');
    const calculations = await all('calculations');
    return (await all('documents'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({
        ...omitFiles(d),
        calculation: {
          ...calculations.find((c) => c.id === d.calculationId),
          teacher: {
            name: teachers.find((t) => t.id === d.teacherId)?.name ?? d.snapshot.teacher.name,
          },
        },
      }));
  }
  if (parts[0] === 'documents' && parts[2] === 'status') {
    const old = await required('documents', parts[1]);
    if (
      !['DRAFT', 'REVIEW', 'READY', 'SIGNED', 'CORRECTION'].includes(body.status) ||
      body.basis?.trim().length < 5
    )
      throw Error('Укажите статус и основание');
    if (
      ['READY', 'SIGNED'].includes(body.status) &&
      (old.snapshot.errors.length || old.snapshot.draft || !old.pdfBytes)
    )
      throw Error('Черновик или документ с ошибками нужно пересоздать как финальный');
    await put('documents', { ...old, status: body.status });
    await record('DOCUMENT_STATUS', old.id, { from: old.status, ...body });
    return omitFiles({ ...old, status: body.status });
  }
  if (parts[0] === 'documents' && parts[2] === 'drive') {
    const doc = await required('documents', parts[1]);
    if (doc.driveId) return omitFiles(doc);
    if (!doc.pdfBytes) throw Error('PDF ещё не создан');
    const teacher = await required('teachers', doc.teacherId);
    if (!teacher.folderId) throw Error('Не указана папка преподавателя');
    const file = await uploadPdf(
      teacher.folderId,
      `Акт ${doc.actNumber} v${doc.version}.pdf`,
      new Uint8Array(doc.pdfBytes),
    );
    doc.driveId = file.id;
    doc.uploadError = '';
    await put('documents', doc);
    await record('DRIVE_UPLOAD', doc.id);
    return omitFiles(doc);
  }
  if (pathname === '/audit')
    return (await all('audit'))
      .filter(
        (a) => !url.searchParams.get('entityId') || a.entityId === url.searchParams.get('entityId'),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 300);
  throw Error('Действие не поддерживается в браузерной версии: ' + pathname);
}
