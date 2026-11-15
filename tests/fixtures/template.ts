// A synthetic structural fixture only. This is not a legal template for production use.
import PizZip from 'pizzip';
const paragraphs = [
  'г. Москва «[ДЕНЬ]» [МЕСЯЦ] 2026 г.',
  'Приложение № 2\nк Договору № [НОМЕР ДОГОВОРА]\nот «[ДЕНЬ]» [МЕСЯЦ] 2026 г.',
  'к Заданию № [НОМЕР ЗАДАНИЯ] от [ДАТА ЗАДАНИЯ]',
  'АКТ ОКАЗАННЫХ УСЛУГ № [НОМЕР АКТА]',
  'за период с [ДАТА] по [ДАТА]',
  'Тестовый заказчик направил документ [ФИО ИСПОЛНИТЕЛЯ].',
  '1. Источник «[НАЗВАНИЕ ТАБЛИЦЫ]», лист «[НАЗВАНИЕ ЛИСТА]», по состоянию на [ДАТА И ВРЕМЯ].',
  '2. Стоимость: [СУММА] ([СУММА ПРОПИСЬЮ]). Компенсация: [СУММА] ([СУММА ПРОПИСЬЮ]). Итог: [ОБЩАЯ СУММА] ([ОБЩАЯ СУММА ПРОПИСЬЮ]).',
  '3. Услуги: Заказчик претензий не имеет / УКАЗАТЬ СОГЛАСОВАННЫЕ ЗАМЕЧАНИЯ.',
  '4. Результаты: [ПЕРЕЧЕНЬ / «НЕ СОЗДАВАЛИСЬ»]. Тестовый пункт об интеллектуальных правах.',
  '5. Тестовый пункт: чек НПД.',
  '6. Акт подписывается: тестовое положение.',
  'ИСПОЛНИТЕЛЬ: [ФИО]',
  '________________ / [ФАМИЛИЯ И. О.] /',
];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function createTestTemplate() {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map(
        (s) =>
          `<w:p><w:r>${s
            .split('\n')
            .map((line, i) => (i ? '<w:br/>' : '') + `<w:t>${esc(line)}</w:t>`)
            .join('')}</w:r></w:p>`,
      )
      .join(
        '',
      )}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Тестовая таблица</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:bottom="850" w:left="850" w:right="850"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer' });
}
