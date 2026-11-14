import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cleanup: string[] = [];
afterEach(() => { for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function testApp(extra: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sft-test-')); cleanup.push(dir);
  const config = loadConfig({ NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '8443', PUBLIC_ORIGIN: 'http://localhost', JWT_SECRET: 'unit-test-secret-with-at-least-32-characters', DATA_DIR: dir, TLS_ENABLED: 'false', MTLS_ENABLED: 'false', MAX_FILE_BYTES: '10485760', DEFAULT_STORAGE_QUOTA_BYTES: '20971520', MIN_FREE_DISK_BYTES: '0', MAX_ACTIVE_UPLOADS_PER_USER: '5', MAX_WS_CONNECTIONS_PER_USER: '5', UPLOAD_BYTES_PER_SECOND: '10485760', DOWNLOAD_BYTES_PER_SECOND: '10485760', TRUST_PROXY: 'false', REGISTRATION_ENABLED: 'true', ...extra });
  return { app: await buildApp(config), dir };
}
const account = { username: 'alice', password: 'Strong-Pass-123!' };
function refreshCookie(response: { cookies: Array<{name: string; value: string}> }) { return response.cookies.find((c) => c.name === 'sft_refresh')!.value; }

describe('authentication and authorization', () => {
  it('always registers public accounts as users and protects file APIs', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'GET', url: '/api/files' })).statusCode).toBe(401);
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account });
    expect(register.statusCode).toBe(200); expect(register.json().user.role).toBe('user');
    const list = await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${register.json().accessToken}` } });
    expect(list.statusCode).toBe(200); expect(list.json()).toEqual({ files: [] });
    await app.close();
  });

  it('rejects exact, case-folded and NFKC-normalized duplicate registrations', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: account })).statusCode).toBe(200);
    for (const username of ['alice', 'ALICE', 'Ａｌｉｃｅ']) {
      const result = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...account, username } });
      expect(result.statusCode).toBe(409); expect(result.json().error).toBe('用户名已存在');
    }
    await app.close();
  });

  it('lets the database resolve concurrent duplicate registration safely', async () => {
    const { app } = await testApp();
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/api/auth/register', payload: account })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    await app.close();
  });

  it('detects refresh-token replay and revokes the whole token family', async () => {
    const { app } = await testApp();
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account });
    const first = refreshCookie(register);
    const rotate = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: `sft_refresh=${first}` } });
    expect(rotate.statusCode).toBe(200);
    const second = refreshCookie(rotate);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: `sft_refresh=${first}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: `sft_refresh=${second}` } })).statusCode).toBe(401);
    await app.close();
  });

  it('invalidates existing access tokens immediately when an account is disabled', async () => {
    const { app, dir } = await testApp();
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account });
    const db = new Database(path.join(dir, 'sft.sqlite'));
    db.prepare("UPDATE users SET status='disabled' WHERE username='alice'").run(); db.close();
    const result = await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${register.json().accessToken}` } });
    expect(result.statusCode).toBe(401);
    await app.close();
  });

  it('changes passwords, revokes old sessions and continues with a fresh session', async () => {
    const { app } = await testApp();
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account });
    const oldToken = register.json().accessToken as string;
    const changed = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: `Bearer ${oldToken}` }, payload: { currentPassword: account.password, newPassword: 'Another-Strong-456!' } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${changed.json().accessToken}` } })).statusCode).toBe(200);
    await app.close();
  });

  it('changes roles explicitly, revokes target sessions and prevents self-demotion', async () => {
    const { app, dir } = await testApp();
    const alice = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account });
    const bobAccount = { username: 'bob', password: 'Strong-Bob-Pass-123!' };
    const bob = await app.inject({ method: 'POST', url: '/api/auth/register', payload: bobAccount });
    const db = new Database(path.join(dir, 'sft.sqlite'));
    db.prepare("UPDATE users SET role='admin' WHERE username='alice'").run();
    const rows = db.prepare('SELECT id,username FROM users').all() as Array<{id: string; username: string}>;
    db.close();
    const aliceId = rows.find((r) => r.username === 'alice')!.id;
    const bobId = rows.find((r) => r.username === 'bob')!.id;
    const aliceToken = alice.json().accessToken as string;

    const promote = await app.inject({ method: 'PATCH', url: `/api/admin/users/${bobId}/role`, headers: { authorization: `Bearer ${aliceToken}` }, payload: { role: 'admin' } });
    expect(promote.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${bob.json().accessToken}` } })).statusCode).toBe(401);
    const bobRelogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: bobAccount });
    expect(bobRelogin.json().user.role).toBe('admin');

    const demote = await app.inject({ method: 'PATCH', url: `/api/admin/users/${bobId}/role`, headers: { authorization: `Bearer ${aliceToken}` }, payload: { role: 'user' } });
    expect(demote.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/files', headers: { authorization: `Bearer ${bobRelogin.json().accessToken}` } })).statusCode).toBe(401);
    const selfDemote = await app.inject({ method: 'PATCH', url: `/api/admin/users/${aliceId}/role`, headers: { authorization: `Bearer ${aliceToken}` }, payload: { role: 'user' } });
    expect(selfDemote.statusCode).toBe(400);
    await app.close();
  });

  it('uses generic login errors and rejects hostile origins', async () => {
    const { app } = await testApp();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'missing', password: 'anything' } });
    expect(login.statusCode).toBe(401); expect(login.json().error).toContain('用户名或密码错误');
    const origin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { username: 'x', password: 'x' } });
    expect(origin.statusCode).toBe(403);
    await app.close();
  });
});

describe('database hardening', () => {
  it('records schema version 2 and prevents audit mutation', async () => {
    const { app, dir } = await testApp();
    const db = new Database(path.join(dir, 'sft.sqlite'));
    expect((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version: number}).version).toBe(2);
    db.prepare("INSERT INTO audit_log(event,detail,created_at) VALUES('test','{}',?)").run(new Date().toISOString());
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/);
    db.close(); await app.close();
  });
});
