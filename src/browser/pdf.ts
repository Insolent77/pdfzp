import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr = (node: any, name: string) =>
  node?.getAttribute('w:' + name) ?? node?.getAttribute(name);
const children = (node: any, name?: string): any[] =>
  Array.from(node?.childNodes ?? []).filter(
    (n: any) => n.nodeType === 1 && (!name || n.localName === name),
  );
const elements = (node: any, name: string): any[] =>
  Array.from(node.getElementsByTagNameNS(ns, name));
function collect(node: any): string {
  if (node.localName === 't') return node.textContent ?? '';
  if (node.localName === 'br') return '\n';
  if (node.localName === 'tab') return '    ';
  return children(node).map(collect).join('');
}
function runs(paragraph: any) {
  return elements(paragraph, 'r')
    .filter((r) => r.parentNode === paragraph || r.parentNode?.localName === 'hyperlink')
    .map((run) => {
      const props = children(run, 'rPr')[0];
      const size = Number(attr(children(props, 'sz')[0], 'val')) / 2;
      return {
        text: collect(run),
        bold: !!children(props, 'b').length,
        italics: !!children(props, 'i').length,
        ...(size ? { fontSize: Math.min(16, Math.max(8, size)) } : {}),
      };
    })
    .filter((x) => x.text);
}
function paragraph(node: any, inTable = false) {
  const props = children(node, 'pPr')[0];
  const align = attr(children(props, 'jc')[0], 'val');
  const pageBreak = elements(node, 'br').some((b) => attr(b, 'type') === 'page');
  const rich = runs(node).map((run) =>
    inTable ? { ...run, fontSize: Math.min(run.fontSize ?? 8.5, 9) } : run,
  );
  if (!rich.length && pageBreak) return { text: '', pageBreak: 'before' };
  return {
    text: rich.length ? rich : [{ text: ' ' }],
    fontSize: inTable ? 8.5 : 10,
    alignment: ['center', 'right', 'justify'].includes(align) ? align : 'left',
    margin: [0, 0, 0, inTable ? 2 : 5],
    ...(pageBreak ? { pageBreak: 'before' } : {}),
  };
}
function parseTable(node: any) {
  const rows = children(node, 'tr');
  const body = rows.map((row) =>
    children(row, 'tc').map((cell) => {
      const paragraphs = children(cell, 'p');
      return { stack: paragraphs.map((p) => paragraph(p, true)), margin: [3, 3, 3, 3] };
    }),
  );
  const columns = Math.max(0, ...body.map((r) => r.length));
  for (const row of body)
    while (row.length < columns) row.push({ stack: [{ text: ' ' } as any], margin: [3, 3, 3, 3] });
  const heading = rows[0] ? children(rows[0], 'tc').map(collect).join(' ') : '';
  let widths: any = Array(columns).fill('*');
  if (columns === 6)
    widths = /Ученик|Дата/.test(heading) ? [55, 100, 75, 52, 65, '*'] : [18, '*', 47, 57, 75, 62];
  return {
    table: { headerRows: 1, dontBreakRows: true, widths, body },
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,
      hLineColor: () => '#aab0b8',
      vLineColor: () => '#aab0b8',
    },
    margin: [0, 4, 0, 10],
  };
}
export function pdfDefinition(docx: Uint8Array) {
  const zip = new PizZip(docx);
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw Error('Некорректный DOCX');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const body = dom.getElementsByTagNameNS(ns, 'body')[0];
  if (!body) throw Error('В DOCX отсутствует содержимое');
  const content: any[] = children(body)
    .filter((n) => ['p', 'tbl'].includes(n.localName))
    .map((n) => (n.localName === 'tbl' ? parseTable(n) : paragraph(n)));
  return {
    pageSize: 'A4' as const,
    pageMargins: [36, 36, 36, 36] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content,
    footer: (page: number, pages: number) => ({
      text: `${page} / ${pages}`,
      alignment: 'right',
      margin: [36, 8, 36, 0],
      fontSize: 8,
      color: '#777777',
    }),
    info: { title: 'Акт оказанных услуг и реестр', creator: 'Мой Ломоносов' },
  };
}
export async function createPdf(docx: Uint8Array): Promise<Uint8Array> {
  const [{ default: pdfMake }, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const vfs = (fonts as any).default ?? fonts;
  (pdfMake as any).addVirtualFileSystem(vfs.pdfMake?.vfs ?? vfs.vfs ?? vfs);
  return new Promise((resolve, reject) => {
    try {
      pdfMake
        .createPdf(pdfDefinition(docx) as any)
        .getBuffer((bytes) => resolve(new Uint8Array(bytes)));
    } catch (e) {
      reject(e);
    }
  });
}
