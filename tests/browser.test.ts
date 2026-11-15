import 'fake-indexeddb/auto';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createTestTemplate } from './fixtures/template';
import { browserAction } from '../src/browser/service';
import { all, get, backupData, importBackup } from '../src/browser/storage';
import { parseSummary } from '../src/browser/sources';
import { pdfDefinition } from '../src/browser/pdf';

test('браузер без сервера: CSV → IndexedDB → DOCX → настоящий PDF → версии и резервная копия', async () => {
  const session = await browserAction('/auth/session');
  assert.equal(session.user.id, 'local-workspace');
  const teacher = await browserAction('/teachers', 'POST', {
    name: 'Синтетический преподаватель',
    dativeName: 'Синтетическому преподавателю',
    kind: 'NPD',
    contractNumber: 'TEST-2026',
    contractDate: '2026-09-01',
    assignmentNumber: '1',
    assignmentDate: '2026-09-01',
    folderId: 'test_folder_123456',
    verified: true,
    requisites: { ИНН: 'Тестовые реквизиты' },
    rules: { approved: true, unitMinutes: 60 },
    mapping: { total: '1200.50' },
  });
  await browserAction(`/teachers/${teacher.id}/rates`, 'POST', {
    from: '2026-09-01',
    to: null,
    service: 'INDIVIDUAL',
    format: '',
    amount: '800',
    unitMinutes: 60,
    confirmed: true,
  });
  const csv = new FormData();
  csv.set('month', '10');
  csv.set('year', '2026');
  csv.set(
    'file',
    new File(
      ['Дата;Ученик;Длительность;Проведено;Начисление\n2026-10-12;Ученик №1.1;90;1;1200,50'],
      'salary.csv',
      { type: 'text/csv' },
    ),
  );
  const calc = await browserAction(`/teachers/${teacher.id}/import`, 'POST', csv);
  assert.equal(calc.report.total, '1200.50');
  assert.equal(calc.report.units, '1.5');
  assert.deepEqual(calc.report.errors, []);
  const changed = await browserAction(`/teachers/${teacher.id}/adjustments`, 'POST', {
    month: 10,
    year: 2026,
    type: 'BONUS',
    amount: '10',
    basis: 'Синтетическая доплата для теста',
  });
  assert.equal(changed.calculation.report.total, '1210.50');
  assert.equal(changed.calculation.version, 2);
  await browserAction('/settings/customer', 'PUT', {
    name: 'Тестовый заказчик',
    fullName: 'Тестовый заказчик',
    signature: 'Тестовый З.',
    requisites: 'Тестовые реквизиты',
  });
  await browserAction('/settings/driveCopy', 'PUT', { enabled: false });
  const file = new FormData();
  file.set('kind', 'NPD');
  file.set('file', new File([new Uint8Array(createTestTemplate())], 'template.docx'));
  const imported = await browserAction('/templates/import', 'POST', file);
  await browserAction('/templates/approve', 'POST', {
    kind: 'NPD',
    hash: imported.hash,
    basis: 'Синтетическое тестовое подтверждение',
  });
  const input = {
    calculationId: changed.calculation.id,
    actNumber: '1',
    actDate: '2026-11-01',
    confirmations: {
      claims: 'Тест: замечания не заявлены.',
      intellectualProperty: 'не создавались',
      terms: true,
      npd: true,
      templateApproved: true,
      numberingBasis: 'Синтетический регламент нумерации',
    },
  };
  const check = await browserAction('/documents/preflight', 'POST', input);
  assert.equal(check.canFinalize, true, JSON.stringify(check.errors));
  const doc = await browserAction('/documents', 'POST', input);
  assert.equal(doc.status, 'READY');
  const stored = await get('documents', doc.id);
  assert.equal(new TextDecoder().decode(new Uint8Array(stored.pdfBytes).slice(0, 5)), '%PDF-');
  assert.ok(stored.pdfBytes.byteLength > 5000);
  if (process.env.QA_OUTPUT_DIR) {
    await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
    await writeFile(
      process.env.QA_OUTPUT_DIR + '/browser-act.pdf',
      new Uint8Array(stored.pdfBytes),
    );
  }
  assert.ok(
    JSON.stringify(pdfDefinition(new Uint8Array(stored.docxBytes))).includes(
      'РЕЕСТР ОКАЗАННЫХ УСЛУГ',
    ),
  );
  await assert.rejects(() => browserAction('/documents', 'POST', input), /новой версии/);
  const next = await browserAction('/documents', 'POST', { ...input, newVersion: true });
  assert.equal(next.version, 2);
  const history = await browserAction('/documents');
  assert.equal(history.length, 2);
  assert.equal(history[0].calculationId, changed.calculation.id);
  const backup = await backupData();
  assert.equal(typeof backup.records.documents[0].pdfBytes, 'string');
  assert.equal(
    typeof backup.records.settings.find((s) => s.key === 'template').value.bytes,
    'string',
  );
  await importBackup(new File([JSON.stringify(backup)], 'backup.json'));
  assert.equal((await all('documents')).length, 2);
  assert.equal((await get('documents', doc.id)).pdfBytes.byteLength, stored.pdfBytes.byteLength);
  const clone = await browserAction('/templates/approve', 'POST', {
    kind: 'NPD',
    hash: imported.hash,
    basis: 'После восстановления файл доступен',
  });
  assert.equal(clone.approved, true);
  assert.ok((await browserAction('/audit')).some((a: any) => a.action === 'BACKUP_RESTORE'));
});
test('сводный лист: месяц, реквизиты и подтверждения не подменяются догадками', () => {
  const raw = [
    ['Данные'],
    ['Месяц', '11.26'],
    [],
    [
      'Преподаватель',
      'Итог источника, ₽',
      'Номер договора',
      'Тип исполнителя (СМЗ/ИП)',
      'Договор и задание подтверждены?',
    ],
    ['Синтетическое ФИО', 100, 'TEST', '', 'Нет'],
  ];
  const parsed = parseSummary(raw);
  assert.equal(parsed.period, '11.26');
  assert.equal(parsed.rows[0].kind, 'UNKNOWN');
  assert.equal(parsed.rows[0].verified, false);
  assert.equal(parsed.rows[0].dativeName, '');
});
