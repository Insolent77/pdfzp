import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { money, type Report } from './calculation';
import { words, type Confirmations } from './document-core';
import Decimal from 'decimal.js';
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="DejaVu Serif" w:hAnsi="DejaVu Serif"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
function table(rows: string[][]) {
  return `<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="AAAAAA"/>`).join('')}</w:tblBorders></w:tblPr>${rows.map((r, i) => `<w:tr><w:trPr>${i === 0 ? '<w:tblHeader/>' : ''}<w:cantSplit/></w:trPr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(10000 / r.length)}" w:type="dxa"/></w:tcPr>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}
export function renderDocx(
  template: Uint8Array,
  data: {
    teacher: any;
    report: Report;
    source: any;
    month: number;
    year: number;
    actNumber: string;
    actDate: string;
    confirmations: Confirmations;
    draft: boolean;
    errors: string[];
    calculationId: string;
    version: number;
    customer: any;
  },
) {
  const zip = new PizZip(template);
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw Error('Загружен некорректный DOCX');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = Array.from(doc.getElementsByTagNameNS(ns, 'p'));
  const { teacher: t, report: r } = data;
  const fmt = (date: string) =>
    date
      ? new Date(date + 'T00:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC' })
      : '[НЕ ЗАПОЛНЕНО]';
  const long = (date: string) =>
    date
      ? new Date(date + 'T00:00:00Z').toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : '[НЕ ЗАПОЛНЕНО]';
  const start = `${data.year}-${String(data.month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(data.year, data.month, 0)).toISOString().slice(0, 10);
  const replacements: Record<string, string> = {
    '[НОМЕР ДОГОВОРА]': t.contractNumber,
    '[ДАТА ДОГОВОРА]': long(t.contractDate),
    '[НОМЕР ЗАДАНИЯ]': t.assignmentNumber,
    '[ДАТА ЗАДАНИЯ]': long(t.assignmentDate),
    '[НОМЕР АКТА]': data.actNumber,
    '[ФИО ИСПОЛНИТЕЛЯ]': t.dativeName || '[НЕ ЗАПОЛНЕНО]',
    '[НАЗВАНИЕ ТАБЛИЦЫ]': data.source.title ?? data.source.name ?? 'Загруженный источник',
    '[НАЗВАНИЕ ЛИСТА]': data.source.tab ?? 'Импорт',
    '[ДАТА И ВРЕМЯ]': data.source.syncedAt ?? '',
    '[ФИО]': t.name,
    '[ФАМИЛИЯ И. О.]': t.name
      .split(' ')
      .map((x: string, i: number) => (i ? x[0] + '.' : x))
      .join(' '),
    '[ПЕРЕЧЕНЬ / «НЕ СОЗДАВАЛИСЬ»]':
      data.confirmations.intellectualProperty || '[ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ]',
  };
  let foundAct = false;
  let foundLegal = false;
  let customerSigned = false;
  for (const para of paras) {
    const texts = Array.from(para.getElementsByTagNameNS(ns, 't'));
    if (!texts.length) continue;
    const collect = (node: any): string =>
      node.nodeName === 'w:t'
        ? (node.textContent ?? '')
        : node.nodeName === 'w:br'
          ? '\n'
          : node.nodeName === 'w:tab'
            ? '\t'
            : Array.from(node.childNodes ?? [])
                .map(collect)
                .join('');
    const original = collect(para);
    let text = original;
    if (text.includes('АКТ ОКАЗАННЫХ УСЛУГ')) foundAct = true;
    if (text.startsWith('6. Акт подписывается')) foundLegal = true;
    if (text.includes('г. Москва'))
      text = text.replace(/«\[ДЕНЬ\]» \[МЕСЯЦ\] 2026 г\./, long(data.actDate));
    if (text.includes('к Договору №'))
      text = text
        .replace(/(к Договору №\s*)([^\s\n]+)(?=\s|$)/, (_match, prefix, number) =>
          number.startsWith('[')
            ? prefix + number
            : prefix + (t.contractNumber || '[НЕ ЗАПОЛНЕНО]'),
        )
        .replace(/от «\[ДЕНЬ\]» \[МЕСЯЦ\] 2026 г\./, `от ${long(t.contractDate)}`);
    if (/^от «\[ДЕНЬ\]/.test(text.trim())) text = `от ${long(t.contractDate)}`;
    if (text.includes('к Заданию №'))
      text = `к Заданию № ${t.assignmentNumber || '[НЕ ЗАПОЛНЕНО]'} от ${long(t.assignmentDate)}`;
    if (text.includes('за период с [ДАТА]')) text = `за период с ${fmt(start)} по ${fmt(end)}`;
    if (text.startsWith('2. Стоимость')) {
      const values = [
        r.services,
        words(r.services),
        r.totals.COMPENSATION,
        words(r.totals.COMPENSATION),
        r.total,
        words(r.total),
      ];
      let i = 0;
      text = text.replace(
        /\[(?:СУММА|СУММА ПРОПИСЬЮ|ОБЩАЯ СУММА|ОБЩАЯ СУММА ПРОПИСЬЮ)\]/g,
        () => values[i++] ?? '[ОШИБКА]',
      );
    }
    if (text.startsWith('3. Услуги'))
      text = text.replace(
        'Заказчик претензий не имеет / УКАЗАТЬ СОГЛАСОВАННЫЕ ЗАМЕЧАНИЯ.',
        data.confirmations.claims || '[ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ ЗАМЕЧАНИЙ]',
      );
    for (const [token, value] of Object.entries(replacements)) text = text.split(token).join(value);
    text = text.replace(
      /^Индивидуальный предприниматель .+?(?=\s*\(«Заказчик»\))/,
      data.customer?.fullName || '[ЗАКАЗЧИК НЕ ЗАПОЛНЕН]',
    );
    if (/^ИП\s+/.test(text.trim())) text = data.customer?.name || '[ЗАКАЗЧИК НЕ ЗАПОЛНЕН]';
    if (
      !customerSigned &&
      /^_{3,}\s*\/.*\/$/.test(original.trim()) &&
      !original.includes('[ФАМИЛИЯ')
    ) {
      text = `________________ / ${data.customer?.signature || '[ПОДПИСЬ ЗАКАЗЧИКА]'} /`;
      customerSigned = true;
    }
    if (text !== original) {
      const runs = Array.from(para.childNodes).filter((n) => n.nodeName !== 'w:pPr');
      const rPr = para.getElementsByTagNameNS(ns, 'rPr')[0]?.cloneNode(true);
      for (const run of runs) para.removeChild(run);
      const run = doc.createElementNS(ns, 'w:r');
      if (rPr) run.appendChild(rPr);
      text.split('\n').forEach((line, i) => {
        if (i) run.appendChild(doc.createElementNS(ns, 'w:br'));
        const node = doc.createElementNS(ns, 'w:t');
        node.setAttribute('xml:space', 'preserve');
        node.textContent = line;
        run.appendChild(node);
      });
      para.appendChild(run);
    }
  }
  // IP templates use the same data slots but must be independently approved; never strip NPD clauses silently.
  if (!foundAct || !foundLegal)
    throw Error('Структура шаблона не распознана: требуется адаптер и проверка');
  const firstTable = doc.getElementsByTagNameNS(ns, 'tbl')[0];
  if (!firstTable) throw Error('В шаблоне нет таблицы услуг');
  const labels: Record<string, string> = {
    INDIVIDUAL: 'Индивидуальные занятия — расчетная единица',
    GROUP: 'Групповое занятие — расчетная единица',
    BONUS: 'Дополнительное вознаграждение',
    CORRECTION: 'Корректировка стоимости услуг в связи с заменой преподавателя',
    COMPENSATION:
      'Компенсационная выплата в соответствии с пунктом 9 Задания в связи с поздней отменой занятия или неявкой обучающегося',
    FINE: 'Штрафы',
    UNKNOWN: 'Требует классификации',
  };
  const rows = [
    [
      '№',
      'Услуга / результат',
      'Единица',
      'Количество расчетных единиц',
      'Базовая стоимость занятия, руб.',
      'Сумма, руб.',
    ],
  ];
  for (const [type, label] of Object.entries(labels)) {
    const records = r.entries.filter((e) => e.type === type);
    if (!records.length) continue;
    const batches = new Map<string, typeof records>();
    for (const record of records) {
      const key = ['INDIVIDUAL', 'GROUP'].includes(type)
        ? `${record.unitMinutes ?? 60}:${record.rate}`
        : type;
      batches.set(key, [...(batches.get(key) ?? []), record]);
    }
    for (const batch of batches.values()) {
      const unit = batch[0].unitMinutes ?? data.teacher.rules?.unitMinutes ?? 60;
      const rates = [...new Set(batch.map((e) => e.rate).filter(Boolean))];
      rows.push([
        String(rows.length),
        label + (['INDIVIDUAL', 'GROUP'].includes(type) ? ` ${unit} минут` : ''),
        ['INDIVIDUAL', 'GROUP'].includes(type) ? `${unit} минут` : '—',
        ['INDIVIDUAL', 'GROUP'].includes(type)
          ? batch.reduce((sum, e) => sum.plus(e.units), new Decimal(0)).toString()
          : '—',
        rates.length
          ? rates.join('; ')
          : ['INDIVIDUAL', 'GROUP'].includes(type)
            ? 'По фактическим начислениям; см. реестр'
            : '—',
        money(batch.reduce((sum, e) => sum.plus(e.amount), new Decimal(0))),
      ]);
    }
  }
  const fragment = (s: string) =>
    new DOMParser().parseFromString(`<w:body xmlns:w="${ns}">${s}</w:body>`, 'application/xml')
      .documentElement!;
  firstTable.parentNode!.replaceChild(
    doc.importNode(fragment(table(rows)).firstChild!, true),
    firstTable,
  );
  const body = doc.getElementsByTagNameNS(ns, 'body')[0];
  const sect = Array.from(body.childNodes).find((x) => x.nodeName === 'w:sectPr') ?? null;
  const appendix = fragment(
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
      p('РЕЕСТР ОКАЗАННЫХ УСЛУГ') +
      p(
        `${t.name}. ${fmt(start)} — ${fmt(end)}. Расчёт ${data.calculationId}, версия ${data.version}.`,
      ) +
      table([
        [
          'Дата',
          'Ученик / группа',
          'Тип / формат',
          'Мин. / ед.',
          'Начислено, руб.',
          'Основание / строка',
        ],
        ...r.entries.map((e) => [
          e.date ? fmt(e.date) : '—',
          e.student,
          {
            INDIVIDUAL: 'Индивидуальное',
            GROUP: 'Групповое',
            BONUS: 'Дополнительное вознаграждение',
            COMPENSATION: 'Компенсация',
            CORRECTION: 'Корректировка',
            FINE: 'Штраф',
            UNKNOWN: 'Требует классификации',
          }[e.type] + (e.format ? ' / ' + e.format : ''),
          `${e.minutes} / ${e.units}`,
          e.amount,
          `${e.basis}${e.row ? ` [строка ${e.row}]` : ' (ручная запись)'}`,
        ]),
      ]) +
      p(
        `ИТОГО: ${r.total} ₽ (${words(r.total)}). Источник: ${data.source.url ?? data.source.name ?? ''}.`,
      ),
  );
  for (const n of Array.from(appendix.childNodes)) body.insertBefore(doc.importNode(n, true), sect);
  if (data.draft) {
    const warning = fragment(
      p('ЧЕРНОВИК — ТРЕБУЕТ ПРОВЕРКИ. НЕ ДЛЯ ПОДПИСАНИЯ') + data.errors.map(p).join(''),
    );
    for (const n of Array.from(warning.childNodes).reverse())
      body.insertBefore(doc.importNode(n, true), body.firstChild);
  }
  const output = new XMLSerializer().serializeToString(doc);
  if (/\[(?:СУММА|ДАТА|КОЛ-ВО|СТАВКА|НОМЕР АКТА|ДЕНЬ|МЕСЯЦ)\]/.test(output))
    throw Error('В документе остались незаполненные поля шаблона');
  if (!data.draft && t.kind === 'IP' && /чек НПД/.test(output))
    throw Error('Шаблон ИП содержит положение о чеке НПД: требуется отдельный юридический шаблон');
  zip.file('word/document.xml', output);
  return zip.generate({ type: 'uint8array' });
}
