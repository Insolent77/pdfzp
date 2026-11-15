import { openDB } from 'idb';
export const stores = [
  'teachers',
  'calculations',
  'adjustments',
  'documents',
  'settings',
  'audit',
] as const;
export type Store = (typeof stores)[number];
const database = openDB('lomonosov-acts-browser', 1, {
  upgrade(db) {
    for (const name of stores)
      db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
  },
});
export const uid = () => crypto.randomUUID();
export async function all(name: Store): Promise<any[]> {
  return (await database).getAll(name);
}
export async function get(name: Store, id: string): Promise<any> {
  return (await database).get(name, id);
}
export async function put(name: Store, data: any) {
  await (await database).put(name, data);
  return data;
}
export async function setting(key: string, fallback: any = {}) {
  return (await get('settings', key))?.value ?? fallback;
}
export async function setSetting(key: string, value: any) {
  return put('settings', { key, value });
}
export async function record(action: string, entityId: string, data: any = {}) {
  return put('audit', { id: uid(), action, entityId, data, createdAt: new Date().toISOString() });
}
export async function withStore<T>(name: Store, work: (store: any) => Promise<T>) {
  const tx = (await database).transaction(name, 'readwrite');
  const result = await work(tx.store);
  await tx.done;
  return result;
}
export async function checksum(data: unknown) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data));
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function download(bytes: BlobPart | Blob, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function base64(buffer: ArrayBuffer) {
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary);
}
function from64(text: string) {
  return Uint8Array.from(atob(text), (x) => x.charCodeAt(0)).buffer;
}
export async function backupData() {
  const records: Record<string, any[]> = {};
  for (const name of stores) {
    records[name] = await all(name);
    if (name === 'documents')
      records[name] = records[name].map((d) => ({
        ...d,
        pdfBytes: d.pdfBytes ? base64(d.pdfBytes) : undefined,
        docxBytes: d.docxBytes ? base64(d.docxBytes) : undefined,
      }));
    if (name === 'settings')
      records[name] = records[name].map((s) =>
        s.key === 'template'
          ? {
              ...s,
              value: {
                ...s.value,
                bytes: s.value.bytes ? base64(s.value.bytes) : undefined,
                ipBytes: s.value.ipBytes ? base64(s.value.ipBytes) : undefined,
              },
            }
          : s,
      );
  }
  return { format: 'lomonosov-browser', version: 1, createdAt: new Date().toISOString(), records };
}
export async function exportBackup() {
  download(
    JSON.stringify(await backupData(), null, 2),
    'lomonosov-backup.json',
    'application/json',
  );
}
export async function importBackup(file: File) {
  if (file.size > 100 * 1024 * 1024) throw Error('Резервная копия превышает 100 МБ');
  const payload = JSON.parse(await file.text());
  if (payload.format !== 'lomonosov-browser' || payload.version !== 1 || !payload.records)
    throw Error('Это не резервная копия приложения');
  for (const name of stores) {
    if (!Array.isArray(payload.records[name])) throw Error(`В копии отсутствует раздел ${name}`);
    for (const row of payload.records[name])
      if (typeof row[name === 'settings' ? 'key' : 'id'] !== 'string')
        throw Error('Повреждена структура резервной копии');
  }
  const db = await database;
  const tx = db.transaction([...stores], 'readwrite');
  for (const name of stores) {
    await tx.objectStore(name).clear();
    for (const item of payload.records[name]) {
      if (name === 'documents') {
        if (item.pdfBytes) item.pdfBytes = from64(item.pdfBytes);
        if (item.docxBytes) item.docxBytes = from64(item.docxBytes);
      }
      if (name === 'settings' && item.key === 'template') {
        if (item.value.bytes) item.value.bytes = from64(item.value.bytes);
        if (item.value.ipBytes) item.value.ipBytes = from64(item.value.ipBytes);
      }
      await tx.objectStore(name).put(item);
    }
  }
  await tx.done;
  await record('BACKUP_RESTORE', 'workspace');
}
