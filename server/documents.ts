import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderDocx as renderCore } from '../shared/docx';
export { words, preflight, type Confirmations } from '../shared/document-core';
export function renderDocx(...args: Parameters<typeof renderCore>) {
  return Buffer.from(renderCore(...args));
}
export async function convertDocx(bytes: Buffer) {
  const url = process.env.GOTENBERG_URL;
  if (!url) throw Error('Не настроен сервер конвертации GOTENBERG_URL');
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'act.docx',
  );
  const response = await fetch(`${url}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw Error(`Конвертер PDF: HTTP ${response.status}`);
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw Error('Конвертер вернул некорректный PDF');
  return pdf;
}
export const storageRoot = () => path.resolve(process.env.STORAGE_DIR ?? 'storage');
export async function saveDocument(docx: Buffer, pdf: Buffer) {
  const id = randomUUID();
  const dir = path.join(storageRoot(), 'documents');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const docxPath = path.join(dir, id + '.docx'),
    pdfPath = path.join(dir, id + '.pdf');
  await writeFile(docxPath, docx, { mode: 0o600 });
  await writeFile(pdfPath, pdf, { mode: 0o600 });
  return { docxPath, pdfPath };
}
