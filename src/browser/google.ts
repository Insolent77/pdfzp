import { setting, setSetting } from './storage';
let accessToken = '',
  expiresAt = 0,
  accountEmail = '';
let scriptPromise: Promise<void> | undefined;
const scopes =
  'openid email https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive';
export const defaults = {
  summaryId: '1ypWFnjueX_MCS01e64ucrUpvmwnn3xGpi6HMn3Fox8c',
  summaryTab: 'Данные для актов',
  directoryId: '1XduiZJKUMOwKXBKPWIHWf9Bf4liLtPIkBAKvHaCUJuE',
  templateId: '1LtAoZXs6wcAHootrxZ7iPHwB1c_Cxynk',
  clientId: '',
};
export async function config() {
  return { ...defaults, ...(await setting('sources')) };
}
export function idFromLink(text: string) {
  const id =
    text.trim().match(/\/d\/([\w-]+)/)?.[1] ??
    text.trim().match(/\/folders\/([\w-]+)/)?.[1] ??
    text.trim();
  if (!/^[\w-]{10,150}$/.test(id)) throw Error('Укажите корректную ссылку Google или ID');
  return id;
}
export const connected = () => !!accessToken && Date.now() < expiresAt;
export const accounts = () =>
  connected()
    ? [
        {
          id: 'google',
          email: accountEmail || 'Google-аккаунт',
          active: true,
          updatedAt: new Date().toISOString(),
        },
      ]
    : [];
function loadIdentity() {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://accounts.google.com/gsi/client';
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => {
        scriptPromise = undefined;
        tag.remove();
        reject(Error('Не удалось загрузить вход Google. Проверьте интернет и блокировщики.'));
      };
      document.head.appendChild(tag);
    });
  return scriptPromise;
}
export async function prepareGoogle() {
  const c = await config();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.clientId))
    throw Error('В настройках укажите Google OAuth Client ID типа «Веб-приложение»');
  await loadIdentity();
  return c;
}
export async function connectGoogle() {
  const c = await prepareGoogle();
  await new Promise<void>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: c.clientId,
      scope: scopes,
      callback: (response: any) => {
        if (response.error) return reject(Error(response.error_description || response.error));
        accessToken = response.access_token;
        expiresAt = Date.now() + Number(response.expires_in) * 1000;
        resolve();
      },
      error_callback: (error: any) =>
        reject(
          Error(
            error.type === 'popup_closed'
              ? 'Окно входа Google закрыто'
              : 'Не удалось открыть вход Google. Разрешите всплывающие окна для сайта.',
          ),
        ),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  try {
    const info = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    accountEmail = (await info.json()).email ?? '';
  } catch {
    accountEmail = 'Google-аккаунт';
  }
}
export function disconnectGoogle() {
  accessToken = '';
  expiresAt = 0;
  accountEmail = '';
}
export async function googleFetch(url: string, options: RequestInit = {}) {
  if (!connected())
    throw Error(
      'Подключите Google-аккаунт в настройках. После обновления страницы или истечения доступа войдите повторно.',
    );
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(60000),
  });
  if (response.status === 401) {
    disconnectGoogle();
    throw Error('Доступ Google истёк. Подключите аккаунт повторно.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw Error(body?.error?.message || `Google API: ошибка ${response.status}`);
  }
  return response;
}
export async function metadata(spreadsheetId: string) {
  return (
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties(title),sheets(properties)`,
    )
  ).json();
}
export async function range(spreadsheetId: string, tab: string, cells: string) {
  const a1 = `'${tab.replace(/'/g, "''")}'!${cells}`;
  return (
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1)}?valueRenderOption=UNFORMATTED_VALUE`,
    )
  )
    .json()
    .then((x) => x.values ?? []);
}
export async function readTab(
  spreadsheetId: string,
  title: string,
  endColumn = 'AZ',
  maxRows = 20000,
) {
  const meta = await metadata(spreadsheetId);
  const tab = meta.sheets?.find((s: any) => s.properties?.title === title)?.properties;
  if (!tab) throw Error(`В таблице отсутствует лист «${title}»`);
  if (tab.gridProperties?.rowCount > maxRows)
    throw Error(`Лист «${title}» превышает ${maxRows} строк`);
  return {
    raw: await range(
      spreadsheetId,
      title,
      `A1:${endColumn}${tab.gridProperties?.rowCount ?? maxRows}`,
    ),
    source: {
      kind: 'GOOGLE',
      spreadsheetId,
      title: meta.properties?.title,
      tab: title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${tab.sheetId}`,
      syncedAt: new Date().toISOString(),
    },
  };
}
export async function templateBytes(id: string) {
  const meta = await (
    await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType,name`)
  ).json();
  const url =
    meta.mimeType === 'application/vnd.google-apps.document'
      ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document`
      : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
  return new Uint8Array(await (await googleFetch(url)).arrayBuffer());
}
export async function uploadPdf(folderId: string, name: string, bytes: Uint8Array) {
  const boundary = 'lomonosov-' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: 'application/pdf' })}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    new Uint8Array(bytes),
    `\r\n--${boundary}--`,
  ]);
  return (
    await googleFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    )
  ).json();
}
export async function saveSources(input: any) {
  const next = { ...(await config()), ...input };
  next.clientId = String(next.clientId ?? '').trim();
  for (const key of ['summaryId', 'directoryId', 'templateId'] as const)
    if (next[key]) next[key] = idFromLink(next[key]);
  await setSetting('sources', next);
  return next;
}
