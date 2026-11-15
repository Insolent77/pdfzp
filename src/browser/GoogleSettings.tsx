import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import {
  config,
  saveSources,
  connectGoogle,
  prepareGoogle,
  connected,
  accounts,
  disconnectGoogle,
} from './google';
import { syncTeachers } from './sources';
import { all, record } from './storage';
export function GoogleSettings({
  onAction,
  busy,
}: {
  onAction: (action: () => Promise<any>) => Promise<any>;
  busy: boolean;
}) {
  const [sources, setSources] = useState<any>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    config().then(setSources);
  }, []);
  useEffect(() => {
    if (sources?.clientId) prepareGoogle().catch(() => {});
  }, [sources?.clientId]);
  if (!sources) return <p>Загрузка настроек…</p>;
  return (
    <>
      <h3>Google и источники данных</h3>
      <p>Вход через ваш Google-аккаунт. Сервер и Client Secret не нужны.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onAction(async () => {
            const next = await saveSources(Object.fromEntries(f));
            setSources(next);
            setStatus('Настройки сохранены в этом браузере');
            await record('SOURCES_UPDATE', 'sources');
          });
        }}
      >
        {Object.entries({
          clientId: 'Google OAuth Client ID',
          summaryId: 'Таблица со сводным листом — ссылка или ID',
          summaryTab: 'Название сводного листа',
          directoryId: 'Исходный справочник — ссылка или ID',
          templateId: 'Основной шаблон DOCX — ссылка или ID',
        }).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              name={key}
              defaultValue={sources[key]}
              placeholder={key === 'clientId' ? '…apps.googleusercontent.com' : ''}
              required={key !== 'clientId'}
            />
          </label>
        ))}
        <button disabled={busy}>Сохранить настройки</button>
      </form>
      <p>{connected() ? `Подключён: ${accounts()[0]?.email}` : 'Google-аккаунт не подключён'}</p>
      <button
        className="primary"
        disabled={busy || !sources.clientId}
        onClick={() =>
          onAction(async () => {
            await connectGoogle();
            if (!(await all('teachers')).length) await syncTeachers();
            setStatus('Google подключён. Справочник доступен.');
          })
        }
      >
        Подключить Google-аккаунт <ExternalLink size={15} />
      </button>
      {connected() && (
        <button
          onClick={() => {
            disconnectGoogle();
            setStatus('Google отключён');
          }}
        >
          Отключить Google
        </button>
      )}
      <button
        disabled={busy || !connected()}
        onClick={() =>
          onAction(async () => {
            const result = await syncTeachers();
            setStatus(
              `Добавлено ${result.created}, обновлено ${result.updated}, конфликтов защищённых полей ${result.conflicts.length}. ${result.warnings.join(' ')}`,
            );
          })
        }
      >
        <RefreshCw size={15} /> Синхронизировать преподавателей
      </button>
      {status && (
        <p className="success-text" role="status">
          {status}
        </p>
      )}
      <details className="oauth-help" open={!sources.clientId}>
        <summary>Как получить Client ID — один раз</summary>
        <ol>
          <li>
            Откройте{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>{' '}
            и создайте проект.
          </li>
          <li>
            В «APIs &amp; Services → Library» включите <strong>Google Sheets API</strong> и{' '}
            <strong>Google Drive API</strong>.
          </li>
          <li>
            В «Google Auth Platform» настройте название приложения, контактную почту и аудиторию.
            Для личного использования выберите External / Testing и добавьте свою Google-почту в
            Test users.
          </li>
          <li>
            В разделе Clients создайте OAuth client типа <strong>Web application</strong>.
          </li>
          <li>
            В <strong>Authorized JavaScript origins</strong> добавьте{' '}
            <code>https://insolent77.github.io</code> — без <code>/pdfzp/</code>. Redirect URI для
            этого способа входа не требуется.
          </li>
          <li>
            Скопируйте <strong>Client ID</strong>, вставьте в поле выше и сохраните. Client Secret
            сюда не вводится.
          </li>
          <li>
            Нажмите «Подключить Google-аккаунт», выберите аккаунт с доступом к таблицам и разрешите
            запрошенный доступ. Разрешите всплывающие окна для сайта.
          </li>
        </ol>
        <p>
          После перезагрузки страницы доступ к Google нужно подтвердить заново. Документы и история
          при этом остаются на устройстве. Пока Google не настроен, можно загружать XLSX/CSV и
          исходный DOCX вручную.
        </p>
      </details>
    </>
  );
}
