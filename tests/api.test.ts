import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import bcrypt from 'bcryptjs';
import { createTestTemplate } from './fixtures/template';
test('HTTP API: PostgreSQL, сессия, CSRF, роли, импорт, версия, сверка и запрет неподтверждённого акта', async () => {
  process.env.DATABASE_URL =
    'postgresql://postgres:postgres@127.0.0.1:55439/postgres?connection_limit=1&sslmode=disable';
  process.env.SESSION_SECRET = 'test-only-strong-session-secret-never-use-in-production';
  process.env.APP_URL = 'http://127.0.0.1:35439';
  const pg = await PGlite.create();
  await pg.exec(await readFile('prisma/migrations/202611150001_initial/migration.sql', 'utf8'));
  const socket = new PGLiteSocketServer({
    db: pg,
    host: '127.0.0.1',
    port: 55439,
    maxConnections: 10,
  });
  await socket.start();
  const { createApp } = await import('../server/app');
  const { db } = await import('../server/db');
  const app = createApp();
  const server = app.listen(35439, '127.0.0.1');
  let cookie = '',
    csrf = '';
  async function request(url: string, method = 'GET', body?: any, token = true) {
    const r = await fetch('http://127.0.0.1:35439/api' + url, {
      method,
      headers: {
        Cookie: cookie,
        ...(token ? { 'X-CSRF-Token': csrf } : {}),
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const c = r.headers.getSetCookie();
    if (c.length) cookie = c[0].split(';')[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data };
  }
  try {
    await db.user.create({
      data: {
        email: 'admin@test.ru',
        passwordHash: await bcrypt.hash('a-long-test-password', 4),
        role: 'ADMIN',
      },
    });
    assert.equal((await request('/teachers')).status, 401);
    await request('/auth/session');
    assert.ok(csrf);
    assert.equal(
      (
        await request(
          '/auth/login',
          'POST',
          { email: 'admin@test.ru', password: 'a-long-test-password' },
          false,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/auth/login', 'POST', { email: 'admin@test.ru', password: 'wrong' })).status,
      401,
    );
    assert.equal(
      (
        await request('/auth/login', 'POST', {
          email: 'admin@test.ru',
          password: 'a-long-test-password',
        })
      ).status,
      200,
    );
    const teacher = await request('/teachers', 'POST', {
      name: 'Тестовый преподаватель',
      rules: { approved: true, unitMinutes: 60 },
      mapping: { total: '1200.50' },
    });
    assert.equal(teacher.status, 201);
    const id = teacher.data.id;
    const file = new FormData();
    file.set('month', '10');
    file.set('year', '2026');
    file.set(
      'file',
      new Blob([
        'Дата;Ученик;Длительность;Проведено;Начисление\n2026-10-12;Ученик №1.1;90;1;1200,50',
      ]),
      'salary.csv',
    );
    const imported = await request(`/teachers/${id}/import`, 'POST', file);
    assert.equal(imported.status, 201, JSON.stringify(imported.data));
    assert.equal(imported.data.report.total, '1200.50');
    assert.equal(imported.data.report.units, '1.5');
    assert.equal(imported.data.version, 1);
    const adjusted = await request(`/teachers/${id}/adjustments`, 'POST', {
      month: 10,
      year: 2026,
      type: 'BONUS',
      amount: '10',
      basis: 'Согласованный бонус за подготовку',
    });
    assert.equal(adjusted.status, 201);
    assert.equal(adjusted.data.calculation.version, 2);
    assert.equal(adjusted.data.calculation.report.total, '1210.50');
    const body = {
      calculationId: adjusted.data.calculation.id,
      actNumber: '1',
      actDate: '2026-11-01',
      confirmations: {
        terms: false,
        npd: false,
        claims: '',
        intellectualProperty: '',
        numberingBasis: '',
        templateApproved: false,
      },
    };
    const check = await request('/documents/preflight', 'POST', body);
    assert.equal(check.status, 200);
    assert.equal(check.data.canFinalize, false);
    assert.ok(check.data.errors.length > 4);
    assert.equal((await request('/documents', 'POST', body)).status, 422);
    const conflict = await request(`/teachers/${id}`, 'PUT', {
      ...teacher.data,
      name: 'Изменённое имя',
      revision: 0,
    });
    assert.equal(conflict.status, 409);
    if (process.env.GOTENBERG_URL) {
      const updated = await request(`/teachers/${id}`, 'PUT', {
        ...teacher.data,
        dativeName: 'Тестовому преподавателю',
        kind: 'NPD',
        contractNumber: 'TEST-001',
        contractDate: '2026-09-01',
        assignmentNumber: '1',
        assignmentDate: '2026-09-01',
        verified: true,
        folderId: 'test_folder_123456',
        requisites: { ИНН: 'ТЕСТОВЫЕ РЕКВИЗИТЫ' },
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.data));
      assert.equal(
        (
          await request(`/teachers/${id}/rates`, 'POST', {
            from: '2026-09-01',
            to: null,
            service: 'INDIVIDUAL',
            format: '',
            amount: '800',
            unitMinutes: 60,
            confirmed: true,
          })
        ).status,
        201,
      );
      const freshFile = new FormData();
      freshFile.set('month', '10');
      freshFile.set('year', '2026');
      freshFile.set(
        'file',
        new Blob([
          'Дата;Ученик;Длительность;Проведено;Начисление\n2026-10-12;Ученик №1.1;90;1;1200,50',
        ]),
        'salary.csv',
      );
      const fresh = await request(`/teachers/${id}/import`, 'POST', freshFile);
      assert.equal(fresh.status, 201);
      await request('/settings/customer', 'PUT', {
        name: 'Тестовый заказчик',
        fullName: 'Тестовый заказчик',
        signature: 'Тестовый З.',
        requisites: 'Тестовые реквизиты',
      });
      const templateFile = new FormData();
      templateFile.set('kind', 'NPD');
      templateFile.set('file', new Blob([new Uint8Array(createTestTemplate())]), 'template.docx');
      const template = await request('/templates/import', 'POST', templateFile);
      assert.equal(template.status, 200);
      await request('/templates/approve', 'POST', {
        kind: 'NPD',
        hash: template.data.hash,
        basis: 'Тестовая проверка юридического шаблона',
      });
      const final = {
        ...body,
        calculationId: fresh.data.id,
        confirmations: {
          terms: true,
          npd: true,
          claims: 'Заказчик претензий не имеет.',
          intellectualProperty: 'не создавались',
          numberingBasis: 'Тестовый регламент нумерации',
          templateApproved: true,
        },
      };
      const checkFinal = await request('/documents/preflight', 'POST', final);
      assert.equal(checkFinal.data.canFinalize, true, JSON.stringify(checkFinal.data));
      const generated = await request('/documents', 'POST', final);
      assert.equal(generated.status, 201, JSON.stringify(generated.data));
      assert.equal(generated.data.status, 'READY');
      const pdf = await fetch(`http://127.0.0.1:35439/api/documents/${generated.data.id}/pdf`, {
        headers: { Cookie: cookie },
      });
      assert.equal(pdf.status, 200);
      assert.equal(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString(),
        '%PDF-',
      );
      assert.equal((await request('/documents', 'POST', final)).status, 409);
      const second = await request('/documents', 'POST', { ...final, newVersion: true });
      assert.equal(second.status, 201);
      assert.equal(second.data.version, 2);
      const history = await request('/documents');
      assert.equal(history.data.length, 2);
      assert.equal(history.data[0].calculationId, fresh.data.id);
      const draft = await request('/documents', 'POST', {
        ...final,
        draft: true,
        newVersion: true,
      });
      assert.equal(draft.status, 201);
      await request(`/documents/${draft.data.id}/status`, 'PATCH', {
        status: 'REVIEW',
        basis: 'Передача на проверку',
      });
      assert.equal(
        (
          await request(`/documents/${draft.data.id}/status`, 'PATCH', {
            status: 'READY',
            basis: 'Попытка обойти отметку черновика',
          })
        ).status,
        400,
      );
    }
    const employee = await request('/users', 'POST', {
      email: 'employee@test.ru',
      password: 'employee-test-password',
      role: 'EMPLOYEE',
    });
    assert.equal(employee.status, 201);
    const audit = await request('/audit');
    assert.ok(audit.data.some((e: any) => e.action === 'FILE_IMPORT'));
    await request('/auth/logout', 'POST');
    await request('/auth/session');
    await request('/auth/login', 'POST', {
      email: 'employee@test.ru',
      password: 'employee-test-password',
    });
    assert.equal((await request('/teachers')).status, 200);
    assert.equal((await request('/teachers', 'POST', { name: 'Запрет' })).status, 403);
    assert.equal((await request('/settings')).status, 403);
    console.log(
      'HTTP API verified against embedded PostgreSQL: real requests, persisted versions, auth and permissions',
    );
  } finally {
    await db.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.close();
    await socket.stop();
    await pg.close();
  }
});
