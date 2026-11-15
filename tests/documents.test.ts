import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import PizZip from 'pizzip';
import { renderDocx, convertDocx } from '../server/documents';
import { calculate } from '../server/calculation';
import { createTestTemplate } from './fixtures/template';
const fixture = async () =>
  process.env.ACT_TEMPLATE_PATH ? readFile(process.env.ACT_TEMPLATE_PATH) : createTestTemplate();
const report = calculate(
  [
    ['Дата', 'Ученик', 'Длительность', 'Проведено', 'Начисление'],
    ['2026-10-12', 'Ученик №1.1', 90, 1, 1200],
  ],
  { month: 10, year: 2026, mapping: { total: '1200' }, rules: { approved: true } },
);
export const documentData = {
  teacher: {
    name: 'Тестовый Исполнитель',
    dativeName: 'Тестовому Исполнителю',
    kind: 'NPD',
    contractNumber: 'ТЕСТ-123/2026',
    contractDate: '2026-08-12',
    assignmentNumber: '5',
    assignmentDate: '2026-09-03',
  },
  report,
  source: { title: 'Тестовый источник', tab: '10.26', syncedAt: '2026-11-15T12:00:00Z' },
  month: 10,
  year: 2026,
  actNumber: '17',
  actDate: '2026-11-01',
  confirmations: {
    claims: 'Заказчик претензий не имеет.',
    intellectualProperty: 'не создавались',
    npd: true,
    terms: true,
    numberingBasis: 'Тестовая нумерация',
    templateApproved: true,
  },
  draft: false,
  errors: [],
  calculationId: 'test-calc-id',
  version: 3,
  customer: {},
};
test('адаптер DOCX: договор, задание, суммы, подтверждения и реестр', async () => {
  const template = await fixture();
  const bytes = renderDocx(template, documentData);
  const xml = new PizZip(bytes).file('word/document.xml')!.asText();
  const text = xml.replace(/<[^>]*>/g, '');
  for (const required of [
    'ТЕСТ-123/2026',
    '12 августа 2026',
    '5 от 3 сентября 2026',
    '1 ноября 2026',
    'АКТ ОКАЗАННЫХ УСЛУГ № 17',
    '1200.00',
    'одна тысяча двести рублей 00 копеек',
    'РЕЕСТР ОКАЗАННЫХ УСЛУГ',
    'test-calc-id',
    'Ученик №1.1',
    'не создавались',
    'чек НПД',
  ])
    assert.ok(text.includes(required), required);
  assert.ok(!/\[(ДЕНЬ|МЕСЯЦ|ДАТА|СУММА|СТАВКА|КОЛ-ВО)\]/.test(text));
  assert.ok(xml.includes('w:br'), 'Переносы строк шаблона сохранены');
});
test('черновик явно отмечен, ошибки не скрыты', async () => {
  const bytes = renderDocx(await fixture(), {
    ...documentData,
    draft: true,
    errors: ['Договор не подтверждён'],
  });
  const xml = new PizZip(bytes).file('word/document.xml')!.asText();
  assert.ok(xml.includes('ЧЕРНОВИК — ТРЕБУЕТ ПРОВЕРКИ'));
  assert.ok(xml.includes('Договор не подтверждён'));
});
test('шаблон НПД запрещён для финального документа ИП', async () => {
  assert.throws(
    () =>
      renderDocx(awaitTemplate, {
        ...documentData,
        teacher: { ...documentData.teacher, kind: 'IP' },
      }),
    /шаблон|НПД/i,
  );
});
const awaitTemplate = await fixture();
test(
  'LibreOffice через Gotenberg возвращает настоящий PDF',
  { skip: !process.env.GOTENBERG_URL },
  async () => {
    const pdf = await convertDocx(renderDocx(awaitTemplate, documentData));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 5000);
    if (process.env.QA_OUTPUT_DIR) {
      await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
      await writeFile(process.env.QA_OUTPUT_DIR + '/act.pdf', pdf);
    }
  },
);
