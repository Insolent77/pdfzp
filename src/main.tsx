import React, { useState, useEffect, useRef, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard,
  Users,
  Calculator,
  FileClock,
  Settings,
  GraduationCap,
  RefreshCw,
  FileDown,
  Plus,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  LogOut,
  ArrowRight,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import './style.css';
let csrf = '';
async function api(url: string, method = 'GET', body?: unknown) {
  const form = body instanceof FormData;
  const response = await fetch('/api' + url, {
    method,
    headers: {
      ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const result = await response.json();
  if (result.csrf) csrf = result.csrf;
  if (!response.ok) throw Error([result.error, ...(result.errors ?? [])].join('\n'));
  return result;
}
const rub = (v: unknown) =>
  Number(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  ' ₽';
const timestamp = (v: string) => (v ? new Date(v).toLocaleString('ru-RU') : '—');
const months = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const types: Record<string, string> = {
  INDIVIDUAL: 'Индивидуальное',
  GROUP: 'Групповое',
  BONUS: 'Вознаграждение',
  COMPENSATION: 'Компенсация',
  CORRECTION: 'Корректировка',
  FINE: 'Штраф',
  UNKNOWN: 'Требует классификации',
};
const statuses: Record<string, string> = {
  DRAFT: 'Черновик',
  REVIEW: 'На проверке',
  READY: 'Готов к подписанию',
  SIGNED: 'Подписан',
  CORRECTION: 'Требует исправления',
};
function Badge({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span className={'badge ' + (ok ? 'green' : 'amber')}>
      {ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} {children}
    </span>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={close} aria-label="Закрыть">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [user, setUser] = useState<any>(undefined),
    [page, setPage] = useState(new URLSearchParams(location.search).get('page') ?? 'generator'),
    [teachers, setTeachers] = useState<any[]>([]),
    [teacherId, setTeacherId] = useState(''),
    [month, setMonth] = useState(10),
    [year, setYear] = useState(2026),
    [calc, setCalc] = useState<any>(null),
    [versions, setVersions] = useState<any[]>([]),
    [documents, setDocuments] = useState<any[]>([]),
    [settings, setSettings] = useState<any>(null),
    [users, setUsers] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [editor, setEditor] = useState<any>(null),
    [dialog, setDialog] = useState('');
  const [docForm, setDocForm] = useState<any>({
      actNumber: '',
      actDate: new Date().toISOString().slice(0, 10),
      draft: false,
      newVersion: false,
      confirmations: {
        claims: '',
        intellectualProperty: '',
        npd: false,
        terms: false,
        numberingBasis: '',
        templateApproved: false,
      },
    }),
    [checks, setChecks] = useState<any>(null);
  const admin = user?.role === 'ADMIN';
  const teacher = teachers.find((t) => t.id === teacherId);
  const report = calc?.report;
  const sequence = useRef(0);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function loadTeachers() {
    const rows = await api('/teachers');
    setTeachers(rows);
    setTeacherId((old) => (rows.some((x: any) => x.id === old) ? old : (rows[0]?.id ?? '')));
  }
  async function loadCalculations() {
    const current = ++sequence.current;
    if (!teacherId) {
      setCalc(null);
      setVersions([]);
      return;
    }
    const rows = await api(`/teachers/${teacherId}/calculations?month=${month}&year=${year}`);
    if (current !== sequence.current) return;
    setVersions(rows);
    setCalc(rows[0] ?? null);
  }
  useEffect(() => {
    api('/auth/session')
      .then((s) => setUser(s.user))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (user) run(loadTeachers);
  }, [user?.id]);
  useEffect(() => {
    if (user) run(loadCalculations);
  }, [teacherId, month, year, user?.id]);
  useEffect(() => {
    if (!user) return;
    if (page === 'history') run(async () => setDocuments(await api('/documents')));
    if (page === 'settings' && admin)
      run(async () => {
        setSettings(await api('/settings'));
        setUsers(await api('/users'));
        setAudit(await api('/audit'));
      });
  }, [page, user?.id]);
  useEffect(() => setChecks(null), [docForm, calc?.id]);
  function navigate(next: string) {
    setPage(next);
    setSearch('');
    setError('');
    history.replaceState({}, '', `?page=${next}`);
  }
  async function refresh() {
    await run(async () => {
      if (!teacherId) throw Error('Сначала добавьте или импортируйте преподавателя');
      const c = await api(`/teachers/${teacherId}/calculate`, 'POST', { month, year });
      setCalc(c);
      setVersions((v) => [c, ...v]);
      setNotice('Сервер получил актуальные данные. Сохранена версия ' + c.version);
    });
  }
  async function saveTeacher(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      const payload = { ...editor };
      for (const k of [
        'name',
        'dativeName',
        'kind',
        'spreadsheetId',
        'folderId',
        'contractNumber',
        'contractDate',
        'assignmentNumber',
        'assignmentDate',
        'notes',
      ])
        payload[k] = form.get(k) ?? '';
      for (const k of ['requisites', 'mapping', 'rules'])
        payload[k] = JSON.parse(String(form.get(k) || '{}'));
      payload.verified = form.has('verified');
      payload.archived = form.has('archived');
      await api(
        editor.id ? '/teachers/' + editor.id : '/teachers',
        editor.id ? 'PUT' : 'POST',
        payload,
      );
      setEditor(null);
      await loadTeachers();
      setNotice('Карточка сохранена. Изменённые поля защищены от синхронизации.');
    });
  }
  function openDoc() {
    setDialog('document');
    setChecks(null);
  }
  const nav: [string, string, typeof LayoutDashboard][] = [
    ['generator', 'Генератор актов', LayoutDashboard],
    ['teachers', 'Преподаватели', Users],
    ['calculations', 'Расчёты', Calculator],
    ['history', 'История актов', FileClock],
    ...(admin
      ? [['settings', 'Настройки', Settings] as [string, string, typeof LayoutDashboard]]
      : []),
  ];
  if (user === undefined) return <div className="loading">Загрузка…</div>;
  if (!user)
    return (
      <div className="login">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const s = await api('/auth/login', 'POST', Object.fromEntries(f));
              setUser(s.user);
            });
          }}
        >
          <div className="logo">
            <GraduationCap />
          </div>
          <h1>Мой Ломоносов</h1>
          <p>Генератор актов преподавателей</p>
          <Field label="Электронная почта">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
          <Field label="Пароль">
            <input name="password" type="password" required autoComplete="current-password" />
          </Field>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            Войти <ArrowRight size={16} />
          </button>
          <small>
            <ShieldCheck size={14} /> Доступ только для сотрудников
          </small>
        </form>
      </div>
    );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span className="logo">
            <GraduationCap size={24} />
          </span>
          <div>
            Мой Ломоносов<small>АКТЫ ПРЕПОДАВАТЕЛЕЙ</small>
          </div>
        </div>
        <div className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              {label}
              {key === 'generator' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="private">
            <ShieldCheck size={16} />
            <span>
              Закрытое пространство<small>Справочник и документы</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">{user.email[0].toUpperCase()}</span>
            <span>
              {admin ? 'Администратор' : 'Сотрудник'}
              <small>{user.email}</small>
            </span>
            <button
              className="icon"
              aria-label="Выйти"
              onClick={() =>
                run(async () => {
                  await api('/auth/logout', 'POST');
                  location.reload();
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>
            Рабочее пространство <span className="muted">/</span>{' '}
            {nav.find((n) => n[0] === page)?.[1]}
          </span>
          <span className="secure">
            <span /> Вы вошли в систему
          </span>
        </div>
        <div className="content">
          <div className="page-heading">
            <div className="eyebrow">ДОКУМЕНТЫ И НАЧИСЛЕНИЯ</div>
            <h1>{nav.find((n) => n[0] === page)?.[1] ?? 'Генератор актов'}</h1>
            <p>
              {page === 'generator'
                ? 'Расчёт выплат, проверка данных и формирование актов за отчётный период.'
                : page === 'teachers'
                  ? 'Договорные сведения, источники расчётов и условия работы.'
                  : page === 'history'
                    ? 'Все версии документов и расчётные данные, на основании которых они созданы.'
                    : page === 'settings'
                      ? 'Интеграции, шаблоны, пользователи и журнал действий.'
                      : 'Загрузите данные и проверьте каждое начисление.'}
            </p>
          </div>
          {error && (
            <div className="error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button className="icon" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button className="icon" onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {(page === 'generator' || page === 'calculations') && (
            <>
              <section className="panel filters">
                <Field label="Преподаватель">
                  <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                    <option value="" disabled>
                      Выберите преподавателя
                    </option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Месяц">
                  <select value={month} onChange={(e) => setMonth(+e.target.value)}>
                    {months.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Год">
                  <select value={year} onChange={(e) => setYear(+e.target.value)}>
                    {Array.from({ length: 11 }, (_, i) => 2021 + i).map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </Field>
                <button className="primary" disabled={!calc || busy || !admin} onClick={openDoc}>
                  <FileDown size={17} /> Сформировать PDF-акт
                </button>
              </section>
              <div className="report-meta">
                <span>
                  Отчётный период:{' '}
                  <strong>
                    {months[month - 1]} {year}
                  </strong>
                  {calc && (
                    <>
                      {' '}
                      <span className="divider">|</span> Версия расчёта {calc.version}
                    </>
                  )}
                </span>
                <button className="text-button" onClick={refresh} disabled={busy || !admin}>
                  <RefreshCw size={15} className={busy ? 'spin' : ''} /> Обновить расчёт
                </button>
              </div>
              {page === 'calculations' && (
                <section className="panel import-bar">
                  <div>
                    <h3>Источники начислений</h3>
                    <p>Google Sheets, XLSX / CSV или обоснованная корректировка.</p>
                  </div>
                  <label className="button">
                    <Upload size={16} /> Загрузить файл
                    <input
                      hidden
                      type="file"
                      accept=".xlsx,.csv"
                      disabled={!teacherId || busy || !admin}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          run(async () => {
                            const form = new FormData();
                            form.set('file', file);
                            form.set('month', String(month));
                            form.set('year', String(year));
                            const c = await api(`/teachers/${teacherId}/import`, 'POST', form);
                            setCalc(c);
                            setVersions((v) => [c, ...v]);
                            setNotice('Файл обработан сервером');
                          });
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button disabled={!teacherId || !admin} onClick={() => setDialog('adjustment')}>
                    <Plus size={16} /> Корректировка
                  </button>
                </section>
              )}
              {!report ? (
                <section className="panel empty">
                  <Calculator size={35} />
                  <h2>Начните с расчёта за период</h2>
                  <p>
                    {teacherId
                      ? 'Нажмите «Обновить расчёт» для запроса Google Sheets или загрузите XLSX / CSV в разделе «Расчёты».'
                      : 'Добавьте преподавателя или подключите Google и синхронизируйте справочник в настройках.'}
                  </p>
                  {admin && (
                    <button onClick={() => navigate(teacherId ? 'calculations' : 'settings')}>
                      Перейти к настройке <ArrowRight size={16} />
                    </button>
                  )}
                </section>
              ) : (
                <>
                  <div className="stats">
                    <section className="stat total">
                      <div>
                        Итого к выплате <span>₽</span>
                      </div>
                      <strong>{rub(report.total)}</strong>
                      <small>
                        За {months[month - 1].toLowerCase()} {year} года
                      </small>
                    </section>
                    <section className="stat">
                      <div>Стоимость услуг</div>
                      <strong>{rub(report.services)}</strong>
                      <small>Без компенсационных выплат</small>
                    </section>
                    <section className="stat">
                      <div>Компенсации</div>
                      <strong>{rub(report.totals.COMPENSATION)}</strong>
                      <small>Поздние отмены и неявки</small>
                    </section>
                    <section className="stat">
                      <div>Доп. вознаграждения</div>
                      <strong>{rub(report.totals.BONUS)}</strong>
                      <small>
                        Штрафы и корректировки:{' '}
                        {rub(Number(report.totals.FINE) + Number(report.totals.CORRECTION))}
                      </small>
                    </section>
                  </div>
                  <div className="two-col">
                    <section className="panel overview">
                      <header>
                        <h3>Занятия и расчётные единицы</h3>
                        <Calculator size={17} />
                      </header>
                      <div className="overview-grid">
                        <div>
                          <strong>{report.lessonCount}</strong>
                          <small>проведённых занятий</small>
                        </div>
                        <div>
                          <strong>{report.units}</strong>
                          <small>расчётных единиц</small>
                        </div>
                      </div>
                      <div className="unit-row">
                        <span>
                          <i className="dot blue" />
                          Индивидуальные
                        </span>
                        <strong>
                          {report.individualUnits} ед.{' '}
                          <small>{rub(report.totals.INDIVIDUAL)}</small>
                        </strong>
                      </div>
                      <div className="unit-row">
                        <span>
                          <i className="dot violet" />
                          Групповые
                        </span>
                        <strong>
                          {report.groupUnits} ед. <small>{rub(report.totals.GROUP)}</small>
                        </strong>
                      </div>
                    </section>
                    <section className="panel overview">
                      <header>
                        <h3>Контроль данных</h3>
                        <Badge ok={report.reconciled}>
                          {report.reconciled ? 'Сверка пройдена' : 'Требуется проверка'}
                        </Badge>
                      </header>
                      <div className="control-row">
                        <span>Итог из источника</span>
                        <strong>
                          {report.sourceTotal === null ? 'Не указан' : rub(report.sourceTotal)}
                        </strong>
                      </div>
                      <div className="control-row">
                        <span>Расхождение итога</span>
                        <strong
                          className={report.difference !== '0.00' ? 'warn-text' : 'success-text'}
                        >
                          {report.difference === null ? 'Нет итога' : rub(report.difference)}
                        </strong>
                      </div>
                      <div className="control-row">
                        <span>Договорные сведения</span>
                        <Badge ok={teacher?.verified}>
                          {teacher?.verified ? 'Подтверждены' : 'Не проверены'}
                        </Badge>
                      </div>
                      <div className="sync-time">
                        <RefreshCw size={13} /> Последняя синхронизация:{' '}
                        {timestamp(calc.source.syncedAt ?? calc.createdAt)}
                      </div>
                    </section>
                  </div>
                  {(report.errors.length > 0 || report.warnings.length > 0) && (
                    <details className="validation" open>
                      <summary>
                        <AlertCircle size={17} /> Проверки расчёта: {report.errors.length} ошибок,{' '}
                        {report.warnings.length} предупреждений
                      </summary>
                      <ul>
                        {[...report.errors, ...report.warnings].map((e: string, i: number) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <section className="panel details-table">
                    <header>
                      <div>
                        <h3>
                          Детализация начислений{' '}
                          <span className="count">{report.entries.length}</span>
                        </h3>
                        <p>Фактические начисления из источника и ручные корректировки.</p>
                      </div>
                      <div className="search">
                        <Search size={16} />
                        <input
                          aria-label="Поиск начислений"
                          placeholder="Ученик, группа, основание…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </header>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Дата</th>
                            <th>Ученик / группа</th>
                            <th>Вид выплаты</th>
                            <th>Формат</th>
                            <th>Мин.</th>
                            <th>Единицы</th>
                            <th>Начислено</th>
                            <th>Основание / источник</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.entries
                            .filter((e: any) =>
                              JSON.stringify(e).toLowerCase().includes(search.toLowerCase()),
                            )
                            .map((e: any, i: number) => (
                              <tr key={i}>
                                <td>{e.date || '—'}</td>
                                <td className="student">{e.student || 'Дополнительная выплата'}</td>
                                <td>
                                  <span className={'type type-' + e.type}>{types[e.type]}</span>
                                  {e.issues.length > 0 && (
                                    <span title={e.issues.join('; ')} className="warn-text">
                                      {' '}
                                      ⚠
                                    </span>
                                  )}
                                </td>
                                <td>{e.format || '—'}</td>
                                <td>{e.minutes || '—'}</td>
                                <td>{e.units}</td>
                                <td className="amount">{rub(e.amount)}</td>
                                <td className="basis">
                                  {e.basis || '—'}
                                  {e.sourceUrl.startsWith('https://') && (
                                    <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                                      Строка {e.row} <ExternalLink size={11} />
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={5}>Итого по детализации</td>
                            <td>{report.units}</td>
                            <td>{rub(report.total)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                  <div className="bottom-links">
                    <div>
                      {teacher?.spreadsheetId && (
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${teacher.spreadsheetId}/edit`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Расчётная таблица <ExternalLink size={13} />
                        </a>
                      )}
                      {teacher?.folderId && (
                        <a
                          href={`https://drive.google.com/drive/folders/${teacher.folderId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Папка документов <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <Field label="Версия расчёта">
                      <select
                        value={calc.id}
                        onChange={(e) => setCalc(versions.find((v) => v.id === e.target.value))}
                      >
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            v{v.version} · {timestamp(v.createdAt)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </>
          )}
          {page === 'teachers' && (
            <>
              <div className="section-tools">
                <div className="search">
                  <Search size={16} />
                  <input
                    placeholder="Найти преподавателя…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {admin && (
                  <div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await api('/directory/sync', 'POST');
                          await loadTeachers();
                          setNotice(
                            `Добавлено: ${r.created}, обновлено: ${r.updated}. Конфликтов защищённых полей: ${r.conflicts.length}. Подробности в журнале.`,
                          );
                        })
                      }
                    >
                      <RefreshCw size={16} /> Синхронизировать справочник
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        setEditor({
                          kind: 'UNKNOWN',
                          requisites: {},
                          mapping: {},
                          rules: {
                            unitMinutes: 60,
                            approved: false,
                            flags: {},
                            identifiers: [],
                            extraPatterns: [],
                          },
                        })
                      }
                    >
                      <Plus size={16} /> Добавить
                    </button>
                  </div>
                )}
              </div>
              <section className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Преподаватель</th>
                      <th>Тип</th>
                      <th>Договор / задание</th>
                      <th>Проверка</th>
                      <th>Источники</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {teachers
                      .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                      .map((t) => (
                        <tr key={t.id}>
                          <td className="student">
                            {t.name}
                            <small>{t.notes}</small>
                          </td>
                          <td>
                            {t.kind === 'IP'
                              ? 'ИП'
                              : t.kind === 'NPD'
                                ? 'Самозанятый'
                                : 'Не подтверждён'}
                          </td>
                          <td>
                            {t.contractNumber || 'Нет договора'}
                            <small>Задание: {t.assignmentNumber || 'не указано'}</small>
                          </td>
                          <td>
                            <Badge ok={t.verified}>
                              {t.verified ? 'Проверен' : 'Требует проверки'}
                            </Badge>
                          </td>
                          <td>
                            {t.spreadsheetId && (
                              <a
                                href={`https://docs.google.com/spreadsheets/d/${t.spreadsheetId}/edit`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Таблица <ExternalLink size={12} />
                              </a>
                            )}
                            {t.folderId && (
                              <a
                                href={`https://drive.google.com/drive/folders/${t.folderId}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Документы <ExternalLink size={12} />
                              </a>
                            )}
                          </td>
                          <td>{admin && <button onClick={() => setEditor(t)}>Карточка</button>}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!teachers.length && (
                  <div className="empty">
                    Справочник пуст. Подключите Google в настройках и выполните синхронизацию.
                  </div>
                )}
              </section>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    setTeachers(await api('/teachers?archived=true'));
                    setNotice(
                      'Показаны архивные преподаватели. Снимите отметку «Архив» в карточке для восстановления.',
                    );
                  })
                }
              >
                Показать архив
              </button>
            </>
          )}
          {page === 'history' && (
            <section className="panel table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Акт / преподаватель</th>
                    <th>Период</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Версии</th>
                    <th>Создан</th>
                    <th>Документы</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td className="student">
                        № {d.actNumber}
                        <small>{d.calculation.teacher.name}</small>
                      </td>
                      <td>
                        {months[d.calculation.month - 1]} {d.calculation.year}
                      </td>
                      <td className="amount">{rub(d.amount)}</td>
                      <td>
                        <Badge ok={['READY', 'SIGNED'].includes(d.status)}>
                          {statuses[d.status]}
                        </Badge>
                      </td>
                      <td>
                        Акт v{d.version}
                        <small>Расчёт v{d.calculation.version}</small>
                      </td>
                      <td>{timestamp(d.createdAt)}</td>
                      <td>
                        {d.pdfPath && (
                          <a href={`/api/documents/${d.id}/pdf`}>
                            Скачать PDF <FileDown size={13} />
                          </a>
                        )}
                        {d.docxPath && <a href={`/api/documents/${d.id}/docx`}>Исходный DOCX</a>}
                        {d.driveId && (
                          <a
                            href={`https://drive.google.com/file/d/${d.driveId}/view`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Google Drive <ExternalLink size={12} />
                          </a>
                        )}
                        {d.uploadError && <small className="warn-text">{d.uploadError}</small>}
                      </td>
                      <td>
                        {admin && (
                          <>
                            <button
                              onClick={() => {
                                setEditor(d);
                                setDialog('status');
                              }}
                            >
                              Статус / история
                            </button>
                            {!d.driveId && d.pdfPath && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  run(async () => {
                                    await api(`/documents/${d.id}/drive`, 'POST');
                                    setDocuments(await api('/documents'));
                                  })
                                }
                              >
                                Сохранить в Drive
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!documents.length && (
                <div className="empty">
                  <FileClock size={32} />
                  <h3>Документов пока нет</h3>
                  <p>Сформированные акты и их версии появятся здесь.</p>
                </div>
              )}
            </section>
          )}
          {page === 'settings' && admin && settings && (
            <div className="settings-grid">
              <section className="panel setting">
                <h3>Google Workspace</h3>
                <p>Серверный OAuth. Токены не передаются браузеру.</p>
                {settings.accounts.map((a: any) => (
                  <div className="account" key={a.id}>
                    <span>
                      {a.email}
                      <small>{a.active ? 'Подключён' : 'Отключён'}</small>
                    </span>
                    {a.active && (
                      <button
                        onClick={() =>
                          run(async () => {
                            await api('/google/accounts/' + a.id, 'DELETE');
                            setSettings(await api('/settings'));
                          })
                        }
                      >
                        Отключить
                      </button>
                    )}
                  </div>
                ))}
                <a className="button primary" href="/api/google/connect">
                  Подключить Google-аккаунт <ExternalLink size={15} />
                </a>
                {!settings.googleConfigured && (
                  <p className="warn-text">
                    Администратору сервера нужно задать GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.
                  </p>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api('/directory/sync', 'POST');
                      await loadTeachers();
                      setNotice(
                        `Импорт: ${r.created} новых, ${r.updated} обновлённых, ${r.conflicts.length} конфликтов. Детали — в журнале действий.`,
                      );
                    })
                  }
                >
                  <RefreshCw size={15} /> Импортировать справочник
                </button>
              </section>
              <section className="panel setting">
                <h3>Заказчик</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await api('/settings/customer', 'PUT', Object.fromEntries(f));
                      setSettings(await api('/settings'));
                      setNotice('Реквизиты заказчика сохранены');
                    });
                  }}
                >
                  <Field label="Полное наименование">
                    <input
                      name="fullName"
                      defaultValue={settings.settings.customer?.fullName ?? ''}
                      required
                    />
                  </Field>
                  <Field label="Краткое наименование">
                    <input
                      name="name"
                      defaultValue={settings.settings.customer?.name ?? ''}
                      required
                    />
                  </Field>
                  <Field label="ФИО заказчика для подписи">
                    <input
                      name="signature"
                      defaultValue={settings.settings.customer?.signature ?? ''}
                    />
                  </Field>
                  <Field label="Реквизиты">
                    <textarea
                      name="requisites"
                      defaultValue={settings.settings.customer?.requisites ?? ''}
                      required
                    />
                  </Field>
                  <button disabled={busy}>Сохранить реквизиты</button>
                </form>
              </section>
              <section className="panel setting">
                <h3>Шаблоны DOCX</h3>
                <p>
                  Импортируйте исходный документ, проверьте его и подтвердите конкретную версию.
                  Шаблон ИП подключается отдельно.
                </p>
                {['NPD', 'IP'].map((kind) => (
                  <div className="template" key={kind}>
                    <strong>
                      {kind === 'IP' ? 'Индивидуальный предприниматель' : 'Самозанятый'}
                    </strong>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        f.set('kind', kind);
                        run(async () => {
                          await api('/templates/import', 'POST', f);
                          setSettings(await api('/settings'));
                        });
                      }}
                    >
                      <input
                        name="driveId"
                        placeholder="Google Drive ID шаблона"
                        defaultValue={kind === 'NPD' ? '1LtAoZXs6wcAHootrxZ7iPHwB1c_Cxynk' : ''}
                      />
                      <input name="file" type="file" accept=".docx" />
                      <button disabled={busy}>Импортировать DOCX</button>
                    </form>
                    {settings.settings.template?.[kind === 'IP' ? 'ipPath' : 'path'] && (
                      <>
                        <a href={`/api/templates/${kind}/download`}>Скачать для проверки</a>
                        <button
                          onClick={() => {
                            setEditor({
                              kind,
                              hash: settings.settings.template[kind === 'IP' ? 'ipHash' : 'hash'],
                            });
                            setDialog('template');
                          }}
                        >
                          Подтвердить версию
                        </button>
                        <Badge
                          ok={settings.settings.template[kind === 'IP' ? 'ipApproved' : 'approved']}
                        >
                          {settings.settings.template[kind === 'IP' ? 'ipApproved' : 'approved']
                            ? 'Подтверждён'
                            : 'Не подтверждён'}
                        </Badge>
                      </>
                    )}
                  </div>
                ))}
              </section>
              <section className="panel setting">
                <h3>Хранение и резервные копии</h3>
                <p>
                  Основные документы хранятся в закрытом серверном томе. Резервирование PostgreSQL и
                  файлов выполняет скрипт сервера.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await api('/settings/driveCopy', 'PUT', {
                        enabled: f.has('enabled'),
                        transferApproved: f.has('transferApproved'),
                      });
                      setSettings(await api('/settings'));
                      setNotice('Настройки Google Drive сохранены');
                    });
                  }}
                >
                  <label className="check">
                    <input
                      name="enabled"
                      type="checkbox"
                      defaultChecked={settings.settings.driveCopy?.enabled}
                    />{' '}
                    Сохранять PDF в папках преподавателей
                  </label>
                  <label className="check">
                    <input
                      name="transferApproved"
                      type="checkbox"
                      defaultChecked={settings.settings.driveCopy?.transferApproved}
                    />{' '}
                    Основания передачи данных в Google Drive проверены оператором
                  </label>
                  <button disabled={busy}>Сохранить</button>
                </form>
                <p className="help">
                  Инструкции по размещению в РФ, резервированию и восстановлению находятся в README
                  репозитория.
                </p>
              </section>
              <section className="panel setting wide">
                <header>
                  <h3>Пользователи и права</h3>
                  <button onClick={() => setDialog('user')}>
                    <Plus size={15} /> Пользователь
                  </button>
                </header>
                <table>
                  <thead>
                    <tr>
                      <th>Почта</th>
                      <th>Роль</th>
                      <th>Доступ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>
                          {u.role === 'ADMIN'
                            ? 'Администратор'
                            : 'Сотрудник (просмотр и скачивание)'}
                        </td>
                        <td>{u.active ? 'Активен' : 'Отключён'}</td>
                        <td>
                          {u.id !== user.id && (
                            <button
                              onClick={() =>
                                run(async () => {
                                  await api('/users/' + u.id, 'PATCH', {
                                    active: !u.active,
                                    role: u.role,
                                  });
                                  setUsers(await api('/users'));
                                })
                              }
                            >
                              {u.active ? 'Отключить' : 'Включить'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="panel setting wide">
                <header>
                  <h3>Журнал действий администратора</h3>
                  <button onClick={() => run(async () => setAudit(await api('/audit')))}>
                    <RefreshCw size={14} /> Обновить
                  </button>
                </header>
                <div className="audit-list">
                  {audit.map((a) => (
                    <details key={a.id}>
                      <summary>
                        {timestamp(a.createdAt)} · {a.action} · {a.entityId}
                      </summary>
                      <pre>{JSON.stringify(a.data, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </section>
            </div>
          )}
          <footer>
            <span>Мой Ломоносов · Генератор актов преподавателей</span>
            <span>
              <ShieldCheck size={13} /> Все обращения к источникам выполняет сервер
            </span>
          </footer>
        </div>
      </main>
      {editor && !dialog && (
        <Modal
          title={editor.id ? 'Карточка преподавателя' : 'Новый преподаватель'}
          close={() => setEditor(null)}
        >
          <form onSubmit={saveTeacher}>
            <div className="form-grid">
              {Object.entries({
                name: 'ФИО',
                dativeName: 'ФИО в дательном падеже',
                spreadsheetId: 'Расчётная таблица — ссылка или ID',
                folderId: 'Папка документов — ссылка или ID',
                contractNumber: 'Номер договора',
                contractDate: 'Дата договора',
                assignmentNumber: 'Номер задания',
                assignmentDate: 'Дата задания',
              }).map(([k, label]) => (
                <Field key={k} label={label}>
                  <input
                    name={k}
                    type={k.endsWith('Date') ? 'date' : 'text'}
                    defaultValue={editor[k] ?? ''}
                    required={k === 'name'}
                  />
                </Field>
              ))}
              <Field label="Тип исполнителя">
                <select name="kind" defaultValue={editor.kind}>
                  <option value="UNKNOWN">Не подтверждён</option>
                  <option value="NPD">Самозанятый</option>
                  <option value="IP">ИП</option>
                </select>
              </Field>
              <Field label="Примечания">
                <textarea name="notes" defaultValue={editor.notes} />
              </Field>
            </div>
            {['requisites', 'mapping', 'rules'].map((k, i) => (
              <Field
                key={k}
                label={
                  [
                    'Реквизиты (JSON: ИНН, банк, счёт и другие поля)',
                    'Соответствие колонок (JSON, индексы с 0)',
                    'Правила расчёта (JSON, подтверждайте по договору)',
                  ][i]
                }
              >
                <textarea
                  className="code"
                  name={k}
                  rows={k === 'rules' ? 10 : 4}
                  defaultValue={JSON.stringify(editor[k] ?? {}, null, 2)}
                />
              </Field>
            ))}
            <p className="help">
              Пример rules:{' '}
              {JSON.stringify({
                unitMinutes: 60,
                approved: false,
                flags: { '0.5': { type: 'COMPENSATION', unitsFactor: '0', requiresBasis: true } },
                extraPatterns: [{ pattern: 'бонус', type: 'BONUS' }],
              })}
              . Для спорных дат задайте allowPeriodMismatch только после сверки.
            </p>
            <label className="check">
              <input name="verified" type="checkbox" defaultChecked={editor.verified} /> Договор и
              задание проверены
            </label>
            <label className="check">
              <input name="archived" type="checkbox" defaultChecked={editor.archived} /> Архив
            </label>
            {editor.id && (
              <details>
                <summary>Ставки и периоды действия ({editor.rates?.length ?? 0})</summary>
                {editor.rates?.map((r: any) => (
                  <p key={r.id}>
                    {r.from} — {r.to ?? 'бессрочно'} · {types[r.service]} · {r.amount} ₽ /{' '}
                    {r.unitMinutes} мин. · {r.confirmed ? 'подтверждена' : 'не проверена'}
                  </p>
                ))}
                <button type="button" onClick={() => setDialog('rate')}>
                  Добавить ставку
                </button>
              </details>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setEditor(null)}>
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Сохранить карточку
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'document' && (
        <Modal title="Формирование PDF-акта" close={() => setDialog('')}>
          <p>
            Акт и реестр будут сформированы по расчёту v{calc?.version}. Юридические положения
            требуют вашего подтверждения.
          </p>
          <div className="form-grid">
            <Field label="Номер акта (по принятой нумерации)">
              <input
                value={docForm.actNumber}
                onChange={(e) => setDocForm({ ...docForm, actNumber: e.target.value })}
              />
            </Field>
            <Field label="Дата акта">
              <input
                type="date"
                value={docForm.actDate}
                onChange={(e) => setDocForm({ ...docForm, actDate: e.target.value })}
              />
            </Field>
          </div>
          {Object.entries({
            numberingBasis: 'Основание нумерации',
            claims: 'Точная формулировка о претензиях / согласованные замечания',
            intellectualProperty: 'Результаты интеллектуальной деятельности',
          }).map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea
                value={docForm.confirmations[k]}
                onChange={(e) =>
                  setDocForm({
                    ...docForm,
                    confirmations: { ...docForm.confirmations, [k]: e.target.value },
                  })
                }
              />
            </Field>
          ))}
          {Object.entries({
            npd: 'Режим НПД исполнителя проверен',
            terms: 'Договорные условия и расчёт подтверждены',
            templateApproved: 'Шаблон и его юридические положения проверены',
          }).map(([k, label]) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={docForm.confirmations[k]}
                onChange={(e) =>
                  setDocForm({
                    ...docForm,
                    confirmations: { ...docForm.confirmations, [k]: e.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={docForm.draft}
              onChange={(e) => setDocForm({ ...docForm, draft: e.target.checked })}
            />{' '}
            Создать черновик с явной отметкой о проверке
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={docForm.newVersion}
              onChange={(e) => setDocForm({ ...docForm, newVersion: e.target.checked })}
            />{' '}
            Подтверждаю новую версию существующего акта за этот период
          </label>
          {checks && (
            <div className={checks.errors.length ? 'validation' : 'notice'}>
              {checks.canFinalize
                ? 'Проверки пройдены. Можно создать финальный PDF.'
                : checks.errors.map((e: string, i: number) => <p key={i}>{e}</p>)}
              {checks.existing.length > 0 && (
                <p>
                  Уже существует версий: {checks.existing.length}. Нужна отметка о новой версии.
                </p>
              )}
            </div>
          )}
          <div className="modal-actions">
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setChecks(
                    await api('/documents/preflight', 'POST', {
                      ...docForm,
                      calculationId: calc.id,
                    }),
                  ),
                )
              }
            >
              Проверить
            </button>
            <button
              className="primary"
              disabled={busy || (!docForm.draft && !checks?.canFinalize)}
              onClick={() =>
                run(async () => {
                  const d = await api('/documents', 'POST', { ...docForm, calculationId: calc.id });
                  setDialog('');
                  setNotice(
                    `Создан ${docForm.draft ? 'черновик' : 'акт'} v${d.version}. ${d.uploadError || 'Копия сохранена в Google Drive.'}`,
                  );
                  navigate('history');
                })
              }
            >
              <FileDown size={16} />
              {busy ? 'Формирование…' : 'Создать PDF'}
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'adjustment' && (
        <Modal title="Дополнительная выплата / корректировка" close={() => setDialog('')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                const r = await api(`/teachers/${teacherId}/adjustments`, 'POST', {
                  ...Object.fromEntries(f),
                  month,
                  year,
                });
                if (r.calculation) {
                  setCalc(r.calculation);
                  setVersions((v) => [r.calculation, ...v]);
                }
                setDialog('');
                setNotice('Корректировка сохранена с основанием и автором');
              });
            }}
          >
            <Field label="Тип выплаты">
              <select name="type">
                {['BONUS', 'COMPENSATION', 'CORRECTION', 'FINE'].map((t) => (
                  <option value={t} key={t}>
                    {types[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сумма, ₽">
              <input name="amount" type="number" step="0.01" required />
            </Field>
            <Field label="Обязательное основание">
              <textarea name="basis" minLength={5} required />
            </Field>
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'user' && (
        <Modal title="Добавить пользователя" close={() => setDialog('')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api('/users', 'POST', Object.fromEntries(f));
                setUsers(await api('/users'));
                setDialog('');
              });
            }}
          >
            <Field label="Электронная почта">
              <input name="email" type="email" required />
            </Field>
            <Field label="Пароль (от 14 символов)">
              <input
                name="password"
                type="password"
                minLength={14}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Права">
              <select name="role">
                <option value="EMPLOYEE">Сотрудник — просмотр и скачивание</option>
                <option value="ADMIN">Администратор</option>
              </select>
            </Field>
            <button className="primary" disabled={busy}>
              Создать
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'template' && (
        <Modal
          title="Подтвердить юридический шаблон"
          close={() => {
            setDialog('');
            setEditor(null);
          }}
        >
          <p>
            Подтверждается контрольная сумма: <code>{editor.hash}</code>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api('/templates/approve', 'POST', { ...editor, basis: f.get('basis') });
                setSettings(await api('/settings'));
                setDialog('');
                setEditor(null);
              });
            }}
          >
            <Field label="Основание проверки / согласования">
              <textarea name="basis" minLength={10} required />
            </Field>
            <button className="primary" disabled={busy}>
              Подтвердить эту версию
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'rate' && (
        <Modal title="Ставка и период действия" close={() => setDialog('')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api(`/teachers/${editor.id}/rates`, 'POST', {
                  ...Object.fromEntries(f),
                  to: f.get('to') || null,
                  unitMinutes: Number(f.get('unitMinutes')),
                  confirmed: f.has('confirmed'),
                });
                await loadTeachers();
                setEditor(null);
                setDialog('');
              });
            }}
          >
            <div className="form-grid">
              {['from', 'to'].map((k, i) => (
                <Field key={k} label={i ? 'Действует до (необязательно)' : 'Действует с'}>
                  <input type="date" name={k} required={!i} />
                </Field>
              ))}
              <Field label="Услуга">
                <select name="service">
                  <option value="INDIVIDUAL">Индивидуальные</option>
                  <option value="GROUP">Групповые</option>
                </select>
              </Field>
              <Field label="Формат">
                <input name="format" defaultValue="" />
              </Field>
              <Field label="Ставка, ₽">
                <input name="amount" type="number" min="0" step="0.01" required />
              </Field>
              <Field label="Минут в расчётной единице">
                <input name="unitMinutes" type="number" min="1" defaultValue="60" required />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" name="confirmed" /> Условия подтверждены договором
            </label>
            <button className="primary" disabled={busy}>
              Сохранить ставку
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'status' && (
        <Modal
          title="Статус и история документа"
          close={() => {
            setDialog('');
            setEditor(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await api(`/documents/${editor.id}/status`, 'PATCH', Object.fromEntries(f));
                setDocuments(await api('/documents'));
                setDialog('');
                setEditor(null);
              });
            }}
          >
            <Field label="Статус">
              <select name="status" defaultValue={editor.status}>
                {Object.entries(statuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Основание изменения">
              <textarea name="basis" required minLength={5} />
            </Field>
            <button disabled={busy} className="primary">
              Сохранить статус
            </button>
          </form>
          <button
            onClick={() => run(async () => setAudit(await api('/audit?entityId=' + editor.id)))}
          >
            Загрузить историю изменений
          </button>
          <div className="audit-list">
            {audit
              .filter((a) => a.entityId === editor.id)
              .map((a) => (
                <details key={a.id}>
                  <summary>
                    {timestamp(a.createdAt)} · {a.action}
                  </summary>
                  <pre>{JSON.stringify(a.data, null, 2)}</pre>
                </details>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
