import { dateISO, money, type Report } from './calculation';
const plural = (n: number, forms: string[]) =>
  forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
export function words(value: string) {
  const [whole, fraction] = money(value).split('.');
  let n = Number(whole);
  if (!Number.isSafeInteger(n) || n < 0 || n >= 1e12)
    throw Error('Сумма вне диапазона записи прописью');
  const original = n;
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = [
    'десять',
    'одиннадцать',
    'двенадцать',
    'тринадцать',
    'четырнадцать',
    'пятнадцать',
    'шестнадцать',
    'семнадцать',
    'восемнадцать',
    'девятнадцать',
  ];
  const tens = [
    '',
    '',
    'двадцать',
    'тридцать',
    'сорок',
    'пятьдесят',
    'шестьдесят',
    'семьдесят',
    'восемьдесят',
    'девяносто',
  ];
  const hundreds = [
    '',
    'сто',
    'двести',
    'триста',
    'четыреста',
    'пятьсот',
    'шестьсот',
    'семьсот',
    'восемьсот',
    'девятьсот',
  ];
  const scale = [
    ['', '', ''],
    ['тысяча', 'тысячи', 'тысяч'],
    ['миллион', 'миллиона', 'миллионов'],
    ['миллиард', 'миллиарда', 'миллиардов'],
  ];
  const parts: string[] = [];
  let i = 0;
  while (n) {
    const v = n % 1000;
    if (v) {
      const a = [hundreds[Math.floor(v / 100)]];
      const rest = v % 100;
      if (rest >= 10 && rest < 20) a.push(teens[rest - 10]);
      else {
        a.push(tens[Math.floor(rest / 10)]);
        a.push(
          i === 1 && rest % 10 === 1
            ? 'одна'
            : i === 1 && rest % 10 === 2
              ? 'две'
              : ones[rest % 10],
        );
      }
      if (i) a.push(plural(v, scale[i]));
      parts.unshift(a.filter(Boolean).join(' '));
    }
    n = Math.floor(n / 1000);
    i++;
  }
  return `${parts.join(' ') || 'ноль'} ${plural(original, ['рубль', 'рубля', 'рублей'])} ${fraction} ${plural(Number(fraction), ['копейка', 'копейки', 'копеек'])}`;
}
export interface Confirmations {
  claims: string;
  intellectualProperty: string;
  npd: boolean;
  terms: boolean;
  numberingBasis: string;
  templateApproved: boolean;
}
export function preflight(
  teacher: any,
  report: Report,
  input: { actNumber: string; actDate: string; confirmations: Confirmations },
  settings: any,
) {
  const errors = [...report.errors];
  for (const [key, label] of Object.entries({
    contractNumber: 'номер договора',
    contractDate: 'дата договора',
    assignmentNumber: 'номер задания',
    assignmentDate: 'дата задания',
    dativeName: 'ФИО в дательном падеже',
    folderId: 'папка документов',
  })) {
    if (key === 'folderId' && settings.driveCopy?.enabled === false) continue;
    if (!teacher[key]) errors.push(`Не заполнено: ${label}`);
  }
  if (!teacher.verified) errors.push('Договорные сведения не проверены');
  if (!Object.keys(teacher.requisites ?? {}).length)
    errors.push('Не заполнены реквизиты исполнителя');
  if (!['NPD', 'IP'].includes(teacher.kind)) errors.push('Не подтверждён тип исполнителя');
  if (!settings.customer?.name || !settings.customer?.fullName || !settings.customer?.requisites)
    errors.push('Не заполнены реквизиты заказчика');
  if (
    !(teacher.kind === 'IP' ? settings.template?.ipApproved : settings.template?.approved) ||
    !input.confirmations.templateApproved
  )
    errors.push('Шаблон документа не подтверждён');
  if (report.entries.some((e) => ['INDIVIDUAL', 'GROUP'].includes(e.type) && !e.rate))
    errors.push('Не указана подтверждённая базовая ставка для части занятий');
  if (settings.customer?.fullName && !settings.customer.signature)
    errors.push('Укажите ФИО заказчика для подписи');
  if (teacher.kind === 'IP' && !settings.template?.ipPath)
    errors.push('Для ИП нужен отдельный подтверждённый шаблон');
  if (!input.confirmations.terms) errors.push('Не подтверждены условия расчёта');
  if (!input.confirmations.claims?.trim()) errors.push('Не подтверждены замечания к услугам');
  if (!input.confirmations.intellectualProperty?.trim())
    errors.push('Не указаны результаты интеллектуальной деятельности');
  if (teacher.kind === 'NPD' && !input.confirmations.npd) errors.push('Не подтверждён режим НПД');
  if (!input.actNumber?.trim() || !input.confirmations.numberingBasis?.trim())
    errors.push('Нужны номер акта и основание нумерации');
  if (!dateISO(input.actDate)) errors.push('Неверная дата акта');
  if (teacher.contractDate && !dateISO(teacher.contractDate)) errors.push('Неверная дата договора');
  if (teacher.assignmentDate && !dateISO(teacher.assignmentDate))
    errors.push('Неверная дата задания');
  if (teacher.contractDate > input.actDate || teacher.assignmentDate > input.actDate)
    errors.push('Дата договора или задания позднее даты акта');
  return [...new Set(errors)];
}
