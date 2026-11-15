import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from './fixtures/october-synthetic.json';
import { calculate, dateISO, monthKey, type Rules } from '../server/calculation';
import { words, preflight } from '../server/documents';
const rules: Rules = {
  approved: true,
  unitMinutes: 60,
  flags: {
    '0.5': { type: 'COMPENSATION', unitsFactor: '0', requiresBasis: true },
    '0.25': { type: 'COMPENSATION', unitsFactor: '0', requiresBasis: true },
  },
  extraPatterns: [{ pattern: 'вознаграждение', type: 'BONUS' }],
};
const headers = [
  'Дата',
  'Ученик',
  'Тип услуги',
  'Формат',
  'Длительность',
  'Проведено',
  'Начисление',
  'Основание',
  'Тип выплаты',
];
test('контрольный сценарий октября 2026: синтетические строки многострочного формата', () => {
  const r = calculate(raw, { month: 10, year: 2026, rules });
  assert.equal(r.individualUnits, '104');
  assert.equal(r.groupUnits, '32');
  assert.equal(r.totals.INDIVIDUAL, '150068.00');
  assert.equal(r.totals.GROUP, '62120.00');
  assert.equal(r.totals.BONUS, '4600.00');
  assert.equal(r.totals.COMPENSATION, '1080.00');
  assert.equal(r.services, '216788.00');
  assert.equal(r.total, '217868.00');
  assert.equal(r.difference, '0.00');
  assert.equal(r.grossDifference, '0.00');
  assert.deepEqual(r.errors, []);
  assert.ok(r.entries.filter((x) => x.type === 'COMPENSATION').every((x) => x.units === '0'));
});
test('фактическая сумма не умножается повторно на коэффициенты', () => {
  const r = calculate(
    [headers, ['2026-10-12', 'Ученик №1.1', 'Индивидуальное', 'online', 90, 1, 2340, '', '']],
    { month: 10, year: 2026, rules, mapping: { total: '2340' } },
  );
  assert.equal(r.total, '2340.00');
  assert.equal(r.units, '1.5');
  assert.deepEqual(r.errors, []);
});
test('альтернативные коды и переставленные колонки', () => {
  const r = calculate(
    [
      ['Сумма', 'Продолжительность', 'Группа', 'Дата', 'Проведено'],
      ['1980,55', 45, 'TEAM-A', '12.10.2026', 1],
    ],
    {
      month: 10,
      year: 2026,
      rules: { ...rules, unitMinutes: 45, identifiers: [{ pattern: '^TEAM', type: 'GROUP' }] },
      mapping: { total: '1980.55' },
    },
  );
  assert.equal(r.groupUnits, '1');
  assert.equal(r.total, '1980.55');
  assert.deepEqual(r.errors, []);
});
test('незнакомый признак 0.75 не считается проведённым занятием', () => {
  const r = calculate([headers, ['2026-10-12', '№1.1', '', '', 60, 0.75, 100, 'неявка']], {
    month: 10,
    year: 2026,
    rules,
    mapping: { total: '100' },
  });
  assert.equal(r.units, '0');
  assert.equal(r.entries[0].type, 'UNKNOWN');
  assert.ok(r.errors.some((x) => x.includes('0.75')));
});
test('компенсация без основания блокирует финал', () => {
  const r = calculate([headers, ['2026-10-12', '№1.1', '', '', 60, 0.5, 100, '']], {
    month: 10,
    year: 2026,
    rules,
    mapping: { total: '100' },
  });
  assert.ok(r.errors.some((x) => x.includes('основан')));
});
test('денежная сверка до копейки, без балансирующих сумм', () => {
  const r = calculate(
    [
      headers,
      ['2026-10-12', '№1.1', '', '', 60, 1, '0.10', ''],
      ['2026-10-13', '№1.1', '', '', 60, 1, '0.20', ''],
    ],
    { month: 10, year: 2026, rules, mapping: { total: '0.31' } },
  );
  assert.equal(r.total, '0.30');
  assert.equal(r.difference, '-0.01');
  assert.equal(r.entries.length, 2);
  assert.ok(!r.reconciled);
});
test('бонусы, штрафы и ручные изменения сохраняют контрольный итог источника', () => {
  const r = calculate([headers, ['2026-10-12', '№1.1', '', '', 60, 1, 100, '']], {
    month: 10,
    year: 2026,
    rules,
    mapping: { total: '100' },
    adjustments: [
      { id: 'a', type: 'BONUS', amount: '20', basis: 'Согласованный бонус' },
      { id: 'b', type: 'FINE', amount: '5', basis: 'Согласованный штраф' },
    ],
  });
  assert.equal(r.total, '115.00');
  assert.equal(r.difference, '0.00');
  assert.equal(r.sourceTotal, '100.00');
  assert.equal(r.totals.FINE, '-5.00');
});
test('пустой источник и некорректные даты', () => {
  assert.throws(() => calculate([], { month: 10, year: 2026 }), /заголовков/);
  assert.equal(dateISO('31.02.2026'), '');
  assert.equal(dateISO('01.10.2026'), '2026-10-01');
  assert.throws(() => monthKey(13, 2026));
});
test('суммы прописью', () => {
  assert.equal(
    words('217868'),
    'двести семнадцать тысяч восемьсот шестьдесят восемь рублей 00 копеек',
  );
  assert.equal(words('1001.21'), 'одна тысяча один рубль 21 копейка');
  assert.equal(words('0.00'), 'ноль рублей 00 копеек');
});
test('контроль юридических подтверждений: заполненный пример не является подтверждением', () => {
  const r = calculate([headers, ['2026-10-12', '№1.1', '', '', 60, 1, 100, '']], {
    month: 10,
    year: 2026,
    rules,
    mapping: { total: '100' },
  });
  const errors = preflight(
    { kind: 'NPD', requisites: {} },
    r,
    {
      actNumber: '',
      actDate: '2026-11-01',
      confirmations: {
        claims: '',
        intellectualProperty: '',
        terms: false,
        npd: false,
        numberingBasis: '',
        templateApproved: false,
      },
    },
    {},
  );
  assert.ok(errors.some((x) => x.includes('НПД')));
  assert.ok(errors.some((x) => x.includes('интеллектуальной')));
  assert.ok(errors.some((x) => x.includes('нумерации')));
  assert.ok(errors.some((x) => x.includes('реквизиты')));
});
