import { dateISO, norm } from '../../shared/calculation';
import { config, readTab, idFromLink } from './google';
import { all, put, record, uid } from './storage';
const yes = (v: unknown) => norm(v).toLowerCase() === 'да';
export async function readSummary() {
  const cfg = await config();
  return readTab(cfg.summaryId, cfg.summaryTab, 'BN', 1000);
}
export function parseSummary(raw: unknown[][]) {
  const header = raw.findIndex(
    (r) => norm(r[0]) === 'Преподаватель' && r.some((x) => norm(x) === 'Итог источника, ₽'),
  );
  if (header < 0) throw Error('Не найдены заголовки листа «Данные для актов»');
  const h = raw[header].map(norm);
  const period = norm(raw[1]?.[1]);
  return {
    period,
    rows: raw
      .slice(header + 1)
      .filter((r) => norm(r[0]))
      .map((r) => {
        const v = (label: string) => r[h.indexOf(label)];
        const spreadsheet = norm(v('Ссылка на расчёт'));
        const folder = norm(v('Папка документов'));
        const contract = norm(v('Номер договора'));
        const kind = norm(v('Тип исполнителя (СМЗ/ИП)'));
        return {
          name: norm(r[0]),
          dativeName: norm(v('ФИО исполнителя в дательном падеже')),
          kind:
            kind === 'ИП'
              ? 'IP'
              : kind === 'СМЗ'
                ? 'NPD'
                : contract.startsWith('ИП')
                  ? 'IP'
                  : contract.startsWith('СМЗ')
                    ? 'NPD'
                    : 'UNKNOWN',
          spreadsheetId: spreadsheet ? idFromLink(spreadsheet) : '',
          folderId: folder ? idFromLink(folder) : '',
          contractNumber: contract,
          contractDate: dateISO(v('Дата договора (проверить)')),
          assignmentNumber: norm(v('Номер задания')),
          assignmentDate: dateISO(v('Дата задания (проверить)')),
          verified: yes(v('Договор и задание подтверждены?')),
          notes: norm(v('Статус документа / замечания')),
          summary: {
            period,
            values: Object.fromEntries(h.map((label, i) => [label, r[i] ?? ''])),
            sourceRow: header + 2 + raw.slice(header + 1).indexOf(r),
          },
          sourceSnapshot: { period, headers: h, values: r },
        };
      }),
  };
}
export async function syncTeachers() {
  const cfg = await config();
  const warnings: string[] = [];
  let summary: any = { period: '', rows: [] };
  let directory: any[] = [];
  try {
    summary = parseSummary((await readSummary()).raw);
  } catch (e) {
    warnings.push('Сводный лист: ' + (e as Error).message);
  }
  try {
    const source = await readTab(cfg.directoryId, 'Преподаватели', 'AZ', 1000);
    directory = parseDirectory(source.raw);
  } catch (e) {
    warnings.push('Справочник: ' + (e as Error).message);
  }
  const merged = new Map(directory.map((row) => [row.name, row]));
  for (const row of summary.rows) {
    const combined = { ...merged.get(row.name) };
    for (const [key, value] of Object.entries(row))
      if (value !== '' && value !== 'UNKNOWN') combined[key] = value;
    merged.set(row.name, combined);
  }
  const parsed = { period: summary.period, rows: [...merged.values()] };
  if (!parsed.rows.length) throw Error(warnings.join('\n') || 'В источниках нет преподавателей');
  const existing = await all('teachers');
  let created = 0,
    updated = 0;
  const conflicts: any[] = [];
  for (const incoming of parsed.rows) {
    const old = existing.find((t) => t.name === incoming.name);
    if (!old) {
      const row = {
        ...incoming,
        id: uid(),
        requisites: {},
        rules: { unitMinutes: 60, approved: false, flags: {}, identifiers: [], extraPatterns: [] },
        mapping: {},
        rates: [],
        revision: 1,
        archived: false,
        protectedFields: [],
        createdAt: new Date().toISOString(),
      };
      await put('teachers', row);
      created++;
    } else {
      const patch: any = { summary: incoming.summary, sourceSnapshot: incoming.sourceSnapshot };
      for (const [field, value] of Object.entries(incoming)) {
        if (['summary', 'sourceSnapshot'].includes(field)) continue;
        if (JSON.stringify(value) === JSON.stringify(old[field])) continue;
        if (old.verified || old.protectedFields?.includes(field)) {
          conflicts.push({ teacherId: old.id, field, existing: old[field], incoming: value });
        } else if (value !== '') patch[field] = value;
      }
      await put('teachers', { ...old, ...patch, revision: old.revision + 1 });
      updated++;
    }
  }
  await record('DIRECTORY_SYNC', 'directory', {
    created,
    updated,
    conflicts,
    period: parsed.period,
    warnings,
  });
  return { created, updated, conflicts, warnings };
}
export function parseDirectory(raw: unknown[][]) {
  const h = (raw[0] ?? []).map((v) => norm(v).toLowerCase());
  const v = (row: unknown[], ...keys: string[]) =>
    norm(row[h.findIndex((label) => keys.includes(label))]);
  if (!h.includes('фио преподавателя') && !h.includes('фио'))
    throw Error('Не найдены заголовки справочника');
  return raw
    .slice(1)
    .filter((row) => v(row, 'фио преподавателя', 'фио'))
    .map((row) => {
      const contract = v(row, 'договор №', 'номер договора');
      const table = v(row, 'расчётная таблица', 'расчетная таблица');
      const folder = v(row, 'папка с договорами');
      return {
        name: v(row, 'фио преподавателя', 'фио'),
        dativeName: '',
        kind: contract.startsWith('ИП') ? 'IP' : contract.startsWith('СМЗ') ? 'NPD' : 'UNKNOWN',
        spreadsheetId: table ? idFromLink(table) : '',
        folderId: folder ? idFromLink(folder) : '',
        contractNumber: contract,
        contractDate: dateISO(v(row, 'дата договора')),
        assignmentNumber: v(row, 'задание №'),
        assignmentDate: dateISO(v(row, 'дата задания')),
        verified: yes(v(row, 'договор и задание проверены?')),
        notes: v(row, 'контроль данных'),
        sourceSnapshot: { headers: h, values: row },
      };
    });
}
export async function compareSummary(name: string, period: string) {
  const source = await readSummary();
  const summary = parseSummary(source.raw);
  const row = summary.rows.find((t) => t.name === name);
  if (summary.period !== period)
    return {
      source,
      summary: null,
      warnings: [
        `Сводный лист содержит ${summary.period}, выбран ${period}. Расчёт получен из персональной месячной вкладки; сводный лист не переключался.`,
      ],
    };
  if (!row)
    return { source, summary: null, warnings: ['Преподаватель отсутствует в сводном листе'] };
  return { source, summary: row.summary, warnings: [] };
}
