import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
export const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
export function number(v: unknown): Decimal | null {
  if (v === null || v === undefined || norm(v) === '') return null;
  const s = norm(v)
    .replace(/[\s₽%]/g, '')
    .replace(/руб\.?/g, '')
    .replace(',', '.');
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}
export const money = (v: Decimal.Value) =>
  new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type PaymentType =
  | 'INDIVIDUAL'
  | 'GROUP'
  | 'BONUS'
  | 'COMPENSATION'
  | 'CORRECTION'
  | 'FINE'
  | 'UNKNOWN';
export interface Entry {
  row: number;
  date: string;
  student: string;
  service: string;
  format: string;
  minutes: string;
  flag: string;
  units: string;
  unitMinutes?: number;
  rate: string;
  coefficients: unknown[];
  amount: string;
  type: PaymentType;
  basis: string;
  sourceUrl: string;
  issues: string[];
}
export interface Rules {
  unitMinutes?: number;
  flags?: Record<string, { type: PaymentType; unitsFactor: string; requiresBasis?: boolean }>;
  identifiers?: { pattern: string; type: 'INDIVIDUAL' | 'GROUP' }[];
  extraPatterns?: { pattern: string; type: PaymentType }[];
  approved?: boolean;
  allowPeriodMismatch?: boolean;
}
export interface Mapping {
  headerRow?: number;
  startRow?: number;
  date?: number;
  student?: number;
  service?: number;
  format?: number;
  minutes?: number;
  flag?: number;
  amount?: number;
  type?: number;
  basis?: number;
  units?: number;
  rate?: number;
  total?: string;
}
export function dateISO(v: unknown): string {
  if (typeof v === 'number')
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  const s = norm(v);
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(+d) && d.toISOString().slice(0, 10) === iso ? iso : '';
}
export function monthKey(month: number, year: number) {
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  )
    throw Error('Неверный отчётный период');
  return `${String(month).padStart(2, '0')}.${String(year).slice(-2)}`;
}
const aliases: Record<string, string[]> = {
  date: ['дата', 'дата занятия'],
  student: ['ученик', 'ученик или группа', 'группа', 'обучающийся'],
  service: ['тип услуги', 'услуга'],
  format: ['формат', 'локация'],
  minutes: ['длительность, мин', 'продолжительность', 'длительность'],
  flag: ['проведено', 'факт проведения'],
  amount: ['выплата факт', 'фактическое начисление', 'начисление', 'выплата', 'сумма'],
  type: ['тип выплаты'],
  basis: ['основание', 'основание выплаты', 'примечание'],
  units: ['расчетные единицы', 'расчётные единицы'],
  rate: ['ставка', 'исходная ставка'],
};
const types = new Set<PaymentType>([
  'INDIVIDUAL',
  'GROUP',
  'BONUS',
  'COMPENSATION',
  'CORRECTION',
  'FINE',
  'UNKNOWN',
]);
export interface Rate {
  from: string;
  to: string | null;
  service: string;
  format: string;
  amount: string;
  unitMinutes: number;
  confirmed: boolean;
}
export function calculate(
  raw: unknown[][],
  options: {
    month: number;
    year: number;
    rules?: Rules;
    mapping?: Mapping;
    sourceUrl?: string;
    rates?: Rate[];
    adjustments?: { id: string; type: string; amount: string; basis: string }[];
  },
) {
  monthKey(options.month, options.year);
  const rules = options.rules ?? {};
  const mapping = options.mapping ?? {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const first = (raw[0] ?? []).map((x) => norm(x).toLowerCase());
  const legacy = first.includes('проведено') && first.some((x) => x.includes('итог за месяц'));
  const headerRow =
    mapping.headerRow ??
    (legacy
      ? 2
      : raw.findIndex((r) =>
          r.some((x) => ['дата', 'дата занятия'].includes(norm(x).toLowerCase())),
        ));
  if (headerRow < 0) throw Error('Не найдена строка заголовков: задайте соответствие колонок');
  const headers = (raw[headerRow] ?? []).map((x) => norm(x).toLowerCase());
  const cols: Record<string, number> = {};
  for (const [key, names] of Object.entries(aliases))
    cols[key] = Number.isInteger((mapping as any)[key])
      ? (mapping as any)[key]
      : headers.findIndex((x) => names.includes(x));
  if (legacy) {
    cols.amount =
      first.indexOf('выплата факт') >= 0 ? first.indexOf('выплата факт') : first.indexOf('выплата');
    cols.flag = first.indexOf('проведено');
    cols.format = headers.indexOf('локация');
  }
  if (cols.amount < 0) throw Error('Не найдена колонка фактических начислений');
  const sourceSummary = legacy ? (raw[2] ?? []) : [];
  const summary = (text: string) => number(sourceSummary[first.findIndex((x) => x.includes(text))]);
  let sourceTotal = legacy ? summary('итог за месяц') : number(mapping.total);
  const sourceGross = legacy ? summary('сумма по занятиям') : null;
  const sourceFine = legacy ? (summary('сумма по штрафам') ?? new Decimal(0)) : new Decimal(0);
  const sourceBonus = legacy ? (summary('сумма по бонусам') ?? new Decimal(0)) : new Decimal(0);
  let student = '',
    sectionType: PaymentType = 'UNKNOWN';
  const entries: Entry[] = [];
  const identify = (s: string): PaymentType => {
    s = norm(s);
    for (const rule of rules.identifiers ?? []) {
      try {
        if (new RegExp(rule.pattern, 'i').test(s)) return rule.type;
      } catch {
        throw Error('Некорректное регулярное выражение формата');
      }
    }
    if (/групп|полуинд|^гр\s|(?:№\s*|\b)2\.\d+/i.test(s)) return 'GROUP';
    if (/1\.\d+|пробн|индивидуал/i.test(s)) return 'INDIVIDUAL';
    return 'UNKNOWN';
  };
  for (let i = mapping.startRow ?? (legacy ? 4 : headerRow + 1); i < raw.length; i++) {
    const r = raw[i] ?? [];
    if (legacy && /общая выплата за ученика/i.test(norm(r[0]))) {
      student = norm(r[5]);
      sectionType = identify(student);
      continue;
    }
    const amount = number(r[cols.amount]);
    const flag = number(r[cols.flag]);
    if (!amount || (amount.isZero() && !flag?.eq(1))) continue;
    const get = (key: string) => norm(r[cols[key]]);
    const issues: string[] = [];
    const flagKey = flag?.toString() ?? get('flag');
    let type: PaymentType = 'UNKNOWN';
    let units = new Decimal(0);
    const basis = legacy
      ? r
          .slice(cols.flag + 1)
          .filter((x) => norm(x) && number(x) === null)
          .map(norm)
          .join(' ')
      : get('basis');
    const minutes = number(r[cols.minutes]);
    const date = dateISO(r[cols.date]);
    const actualStudent = legacy ? student : get('student');
    const explicit = get('type').toUpperCase();
    const rule = rules.flags?.[flagKey];
    if (types.has(explicit as PaymentType)) type = explicit as PaymentType;
    else if (rule) {
      type = rule.type;
      if (rule.requiresBasis && !basis) issues.push('Нет основания выплаты');
    } else if (flag?.eq(1))
      type = legacy ? sectionType : identify(get('service') + ' ' + actualStudent);
    else if (flag && flag.gt(0) && flag.lt(1))
      issues.push(`Не настроено правило признака проведения ${flagKey}`);
    else {
      for (const p of rules.extraPatterns ?? []) {
        if (new RegExp(p.pattern, 'i').test(basis)) {
          type = p.type;
          break;
        }
      }
      if (type === 'UNKNOWN') issues.push('Требует классификации');
    }
    const isLesson = type === 'INDIVIDUAL' || type === 'GROUP';
    const matchingRates = (options.rates ?? []).filter(
      (rate) =>
        rate.confirmed &&
        rate.from <= date &&
        (!rate.to || rate.to >= date) &&
        rate.service === type &&
        (!rate.format || rate.format === get('format')),
    );
    const rate = matchingRates.length === 1 ? matchingRates[0] : null;
    if (matchingRates.length > 1) issues.push('Неоднозначная ставка: пересекаются условия тарифов');
    if (isLesson) {
      if (!minutes || minutes.lte(0)) issues.push('Не указана длительность');
      else
        units = minutes
          .div(rate?.unitMinutes ?? rules.unitMinutes ?? 60)
          .mul(rule?.unitsFactor ?? '1');
      if (cols.units >= 0 && number(r[cols.units])) units = number(r[cols.units])!;
      if (!date) issues.push('Неверная дата занятия');
    }
    if (
      date &&
      (Number(date.slice(0, 4)) !== options.year || Number(date.slice(5, 7)) !== options.month)
    ) {
      issues.push('Дата строки вне отчётного периода');
      if (rules.allowPeriodMismatch)
        warnings.push(`Строка ${i + 1}: дата ${date} вне периода (разрешено правилом)`);
    }
    if (type === 'UNKNOWN' && !issues.includes('Требует классификации'))
      issues.push('Требует классификации');
    if (['BONUS', 'COMPENSATION', 'CORRECTION', 'FINE'].includes(type) && !basis)
      issues.push('Не указано основание выплаты');
    entries.push({
      row: i + 1,
      date,
      student: actualStudent,
      service: legacy ? sectionType : get('service'),
      format: get('format'),
      minutes: minutes?.toString() ?? '',
      flag: flagKey,
      units: units.toDecimalPlaces(6).toString(),
      unitMinutes: isLesson ? (rate?.unitMinutes ?? rules.unitMinutes ?? 60) : undefined,
      rate: rate?.amount ?? get('rate'),
      coefficients: legacy ? r.slice(7, 12) : [],
      amount: money(type === 'FINE' ? amount.abs().negated() : amount),
      type,
      basis,
      sourceUrl: options.sourceUrl ? `${options.sourceUrl}&range=A${i + 1}` : '',
      issues: issues.filter(
        (x) => !(rules.allowPeriodMismatch && x === 'Дата строки вне отчётного периода'),
      ),
    });
  }
  // Explicit source summary payouts are independent records, never balancing entries.
  if (!sourceBonus.isZero())
    entries.push({
      row: 3,
      date: '',
      student: '',
      service: '',
      format: '',
      minutes: '',
      flag: '',
      units: '0',
      rate: '',
      coefficients: [],
      amount: money(sourceBonus),
      type: 'BONUS',
      basis: 'Сумма по бонусам — итог источника',
      sourceUrl: options.sourceUrl ?? '',
      issues: [],
    });
  if (!sourceFine.isZero())
    entries.push({
      row: 3,
      date: '',
      student: '',
      service: '',
      format: '',
      minutes: '',
      flag: '',
      units: '0',
      rate: '',
      coefficients: [],
      amount: money(sourceFine.abs().negated()),
      type: 'FINE',
      basis: 'Сумма по штрафам — итог источника',
      sourceUrl: options.sourceUrl ?? '',
      issues: [],
    });
  const sourceEntries = entries.filter((x) => x.row !== 3);
  const detailed = sourceEntries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
  const grossDifference = sourceGross ? money(detailed.minus(sourceGross)) : null;
  const baseTotal = entries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
  const difference = sourceTotal ? money(baseTotal.minus(sourceTotal)) : null;
  for (const a of options.adjustments ?? [])
    entries.push({
      row: 0,
      date: '',
      student: '',
      service: '',
      format: '',
      minutes: '',
      flag: '',
      units: '0',
      rate: '',
      coefficients: [],
      amount: money(a.type === 'FINE' ? new Decimal(a.amount).abs().negated() : a.amount),
      type: a.type as PaymentType,
      basis: a.basis,
      sourceUrl: `adjustment:${a.id}`,
      issues: [],
    });
  const totals: Record<string, string> = {};
  for (const type of types)
    totals[type] = money(
      entries.filter((e) => e.type === type).reduce((s, e) => s.plus(e.amount), new Decimal(0)),
    );
  const total = money(entries.reduce((s, e) => s.plus(e.amount), new Decimal(0)));
  const services = money(new Decimal(total).minus(totals.COMPENSATION));
  const individualUnits = entries
    .filter((e) => e.type === 'INDIVIDUAL')
    .reduce((s, e) => s.plus(e.units), new Decimal(0))
    .toString();
  const groupUnits = entries
    .filter((e) => e.type === 'GROUP')
    .reduce((s, e) => s.plus(e.units), new Decimal(0))
    .toString();
  if (!sourceTotal) errors.push('Не указан контрольный итог источника');
  if (difference !== null && difference !== '0.00')
    errors.push(`Расхождение итога: ${difference} ₽`);
  if (grossDifference !== null && grossDifference !== '0.00')
    errors.push(`Расхождение детализации: ${grossDifference} ₽`);
  if (!entries.length) errors.push('Нет начислений за выбранный месяц');
  for (const e of entries) for (const issue of e.issues) errors.push(`Строка ${e.row}: ${issue}`);
  if (!rules.approved) errors.push('Правила расчёта не подтверждены');
  return {
    entries,
    totals,
    total,
    services,
    individualUnits,
    groupUnits,
    units: new Decimal(individualUnits).plus(groupUnits).toString(),
    lessonCount: entries.filter((e) => ['INDIVIDUAL', 'GROUP'].includes(e.type)).length,
    sourceTotal: sourceTotal ? money(sourceTotal) : null,
    sourceGross: sourceGross ? money(sourceGross) : null,
    difference,
    grossDifference,
    errors,
    warnings,
    reconciled: errors.length === 0,
  };
}
export type Report = ReturnType<typeof calculate>;
