import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { z, ZodError } from 'zod';
import { AuthService, bearer, type AuthUser, type SessionContext, TicketStore } from './auth.js';
import { type Config } from './config.js';
import { audit, createDatabase, type Db } from './db.js';
import { hashPassword, normalizeUsername, verifyPassword } from './security.js';
import { StorageService } from './storage.js';
import { registerWebSocket } from './websocket.js';

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_.-]+$/u, '用户名只能包含字母、数字、点、下划线和连字符');
const passwordSchema = z.string().min(12).max(128).refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[^\p{L}\p{N}]/u.test(v), '密码必须同时包含大小写字母、数字和特殊字符');
const reservedNames = new Set(['admin', 'administrator', 'root', 'system', 'support', 'security']);

interface LoginRow {
  id: string; username: string; password_hash: string; role: 'user' | 'admin'; status: 'active' | 'disabled';
  password_changed_at: string; failed_login_count: number; locked_until: string | null;
}

export async function buildApp(config: Config) {
  const https = config.TLS_ENABLED ? {
    key: fs.readFileSync(config.TLS_KEY_PATH), cert: fs.readFileSync(config.TLS_CERT_PATH),
    requestCert: config.MTLS_ENABLED, rejectUnauthorized: config.MTLS_ENABLED,
    ca: config.MTLS_ENABLED ? fs.readFileSync(config.TLS_CA_PATH) : undefined, minVersion: 'TLSv1.2' as const
  } : undefined;
  const baseOptions = {
    logger: config.NODE_ENV !== 'test' ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] } : false,
    trustProxy: config.TRUST_PROXY, bodyLimit: 128 * 1024, requestIdHeader: false as const,
    logController: new LogController({ disableRequestLogging: true }), genReqId: () => crypto.randomUUID()
  };
  const app = (https ? Fastify<HttpsServer>({ ...baseOptions, https }) : Fastify(baseOptions)) as unknown as FastifyInstance;
  const db = createDatabase(config.dataDir);
  const auth = new AuthService(db, config.jwtSecret);
  const tickets = new TicketStore();
  const storage = new StorageService(db, config);
  storage.cleanupStaleUploads();

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", 'wss:', 'ws:'], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"] } }, strictTransportSecurity: config.TLS_ENABLED ? { maxAge: 31536000, includeSubDomains: true } : false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', ban: 3, keyGenerator: (request) => request.ip });
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 + 16 * 1024 } });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== config.PUBLIC_ORIGIN) return reply.code(403).send({ error: '不允许的来源' });
    if (request.url.startsWith('/api/auth/')) reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', async () => ({ status: 'ok', protocol: 1, schema: 2, time: new Date().toISOString() }));
  app.get('/api/config', async () => ({ registrationEnabled: config.REGISTRATION_ENABLED, inviteRequired: Boolean(config.REGISTRATION_INVITE_CODE), maxFileBytes: config.MAX_FILE_BYTES }));

  app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    if (!config.REGISTRATION_ENABLED) return reply.code(403).send({ error: '公开注册已关闭，请联系管理员' });
    const body = z.object({ username: usernameSchema, password: passwordSchema, inviteCode: z.string().max(128).optional() }).parse(request.body);
    if (config.REGISTRATION_INVITE_CODE && !safeEqual(body.inviteCode ?? '', config.REGISTRATION_INVITE_CODE)) return reply.code(403).send({ error: '邀请码无效' });
    const username = normalizeUsername(body.username);
    if (reservedNames.has(username)) return reply.code(400).send({ error: '该用户名为系统保留名称' });
    const passwordHash = await hashPassword(body.password);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO users(id,username,password_hash,role,created_at,status,password_changed_at,storage_quota_bytes)
        VALUES(?,?,?,'user',?,'active',?,?)`).run(id, username, passwordHash, now, now, config.DEFAULT_STORAGE_QUOTA_BYTES);
      audit(db, 'auth.register', { username }, id, request.ip);
      return issueSession(auth, { id, username, role: 'user', sessionVersion: now }, reply, config, sessionContext(request));
    } catch (error: unknown) {
      if (String(error).includes('UNIQUE')) return reply.code(409).send({ error: '用户名已存在' });
      throw error;
    }
  });

  const dummyHash = await hashPassword('Invalid-Password-For-Timing-1!');
  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '15 minutes', ban: 5 } } }, async (request, reply) => {
    const basic = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) }).parse(request.body);
    const username = normalizeUsername(basic.username);
    const row = db.prepare(`SELECT id,username,password_hash,role,status,password_changed_at,failed_login_count,locked_until
      FROM users WHERE username=?`).get(username) as LoginRow | undefined;
    const attempt = db.prepare('SELECT failed_count,locked_until FROM auth_attempts WHERE username=? AND ip=?').get(username, request.ip) as {failed_count: number; locked_until: string | null} | undefined;
    const locked = isFuture(row?.locked_until) || isFuture(attempt?.locked_until);
    const valid = await verifyPassword(basic.password, row?.password_hash ?? dummyHash);
    if (!row || !valid || locked || row.status !== 'active') {
      recordLoginFailure(db, username, request.ip, row);
      audit(db, locked ? 'auth.login_blocked' : 'auth.login_failed', { username }, row?.id, request.ip);
      return reply.code(401).send({ error: '用户名或密码错误，或账户暂不可用' });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM auth_attempts WHERE username=? AND ip=?').run(username, request.ip);
      db.prepare('UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?').run(row.id);
    })();
    audit(db, 'auth.login', {}, row.id, request.ip);
    return issueSession(auth, toUser(row), reply, config, sessionContext(request));
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies.sft_refresh;
    if (!token) return reply.code(401).send({ error: '刷新令牌不存在' });
    const rotated = auth.rotateRefresh(token, sessionContext(request));
    if (!rotated) {
      clearRefresh(reply, config); audit(db, 'auth.refresh_rejected', {}, undefined, request.ip);
      return reply.code(401).send({ error: '刷新令牌无效、已过期或检测到重放' });
    }
    return issueSession(auth, rotated.user, reply, config, sessionContext(request), rotated.token);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.cookies.sft_refresh) auth.revokeRefresh(request.cookies.sft_refresh);
    clearRefresh(reply, config); return { ok: true };
  });
  app.post('/api/auth/logout-all', async (request, reply) => {
    const user = await requireAuth(request, reply, auth); if (!user) return;
    auth.revokeAll(user.id); clearRefresh(reply, config); audit(db, 'auth.logout_all', {}, user.id, request.ip);
    return { ok: true };
  });
  app.post('/api/auth/change-password', async (request, reply) => {
    const user = await requireAuth(request, reply, auth); if (!user) return;
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).parse(request.body);
    if (body.currentPassword === body.newPassword) return reply.code(400).send({ error: '新密码不能与当前密码相同' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id) as {password_hash: string};
    if (!await verifyPassword(body.currentPassword, row.password_hash)) return reply.code(401).send({ error: '当前密码错误' });
    const changedAt = new Date().toISOString(); const newHash = await hashPassword(body.newPassword);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?,password_changed_at=?,failed_login_count=0,locked_until=NULL WHERE id=?').run(newHash, changedAt, user.id);
      auth.revokeAll(user.id);
    }).immediate();
    audit(db, 'auth.password_changed', {}, user.id, request.ip);
    return issueSession(auth, { ...user, sessionVersion: changedAt }, reply, config, sessionContext(request));
  });

  app.get('/api/files', async (request, reply) => {
    const user = await requireAuth(request, reply, auth); if (!user) return;
    return { files: storage.listFiles(user.id).map(publicFile) };
  });
  app.delete('/api/files/:id', async (request, reply) => {
    const user = await requireAuth(request, reply, auth); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await storage.deleteFile(id, user.id); return { ok: true };
  });
  app.post('/api/ws-ticket', async (request, reply) => {
    const user = await requireAuth(request, reply, auth); if (!user) return;
    return { ticket: tickets.issue(user), expiresIn: 30 };
  });

  app.get('/api/admin/users', async (request, reply) => {
    const user = await requireAdmin(request, reply, auth); if (!user) return;
    return { users: db.prepare(`SELECT u.id,u.username,u.role,u.status,u.bandwidth_bps AS bandwidthBps,
      u.storage_quota_bytes AS storageQuotaBytes,u.created_at AS createdAt,
      COALESCE((SELECT SUM(size) FROM files f WHERE f.user_id=u.id),0) AS usedBytes
      FROM users u ORDER BY u.created_at`).all() };
  });
  app.patch('/api/admin/users/:id/settings', async (request, reply) => {
    const admin = await requireAdmin(request, reply, auth); if (!admin) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      bandwidthBps: z.number().int().min(64 * 1024).max(1024 * 1024 * 1024).nullable().optional(),
      storageQuotaBytes: z.number().int().min(1024 * 1024).max(16 * 1024 ** 4).optional(),
      status: z.enum(['active', 'disabled']).optional()
    }).refine((v) => Object.keys(v).length > 0).parse(request.body);
    const target = db.prepare('SELECT id,role,status FROM users WHERE id=?').get(id) as {id: string; role: string; status: string} | undefined;
    if (!target) return reply.code(404).send({ error: '用户不存在' });
    if (body.status === 'disabled' && id === admin.id) return reply.code(400).send({ error: '不能禁用当前登录的管理员' });
    if (body.status === 'disabled' && target.role === 'admin' && activeAdminCount(db) <= 1) return reply.code(400).send({ error: '系统必须保留至少一个启用的管理员' });
    db.transaction(() => {
      if ('bandwidthBps' in body) db.prepare('UPDATE users SET bandwidth_bps=? WHERE id=?').run(body.bandwidthBps ?? null, id);
      if (body.storageQuotaBytes !== undefined) db.prepare('UPDATE users SET storage_quota_bytes=? WHERE id=?').run(body.storageQuotaBytes, id);
      if (body.status !== undefined) {
        db.prepare('UPDATE users SET status=? WHERE id=?').run(body.status, id);
        if (body.status === 'disabled') auth.revokeAll(id);
      }
    }).immediate();
    audit(db, 'admin.user_settings_changed', { targetUserId: id, ...body }, admin.id, request.ip);
    return { ok: true };
  });
  app.patch('/api/admin/users/:id/role', async (request, reply) => {
    const admin = await requireAdmin(request, reply, auth); if (!admin) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(request.body);
    const target = db.prepare('SELECT id,username,role,status FROM users WHERE id=?').get(id) as {id: string; username: string; role: 'user' | 'admin'; status: 'active' | 'disabled'} | undefined;
    if (!target) return reply.code(404).send({ error: '用户不存在' });
    if (target.role === role) return { ok: true };
    if (id === admin.id && role === 'user') return reply.code(400).send({ error: '不能降低当前登录管理员自己的权限' });
    if (target.role === 'admin' && role === 'user' && target.status === 'active' && activeAdminCount(db) <= 1) {
      return reply.code(400).send({ error: '系统必须保留至少一个启用的管理员' });
    }
    const roleChangedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE users SET role=?,password_changed_at=? WHERE id=?').run(role, roleChangedAt, id);
      auth.revokeAll(id);
    }).immediate();
    audit(db, 'admin.user_role_changed', { targetUserId: id, username: target.username, from: target.role, to: role }, admin.id, request.ip);
    return { ok: true };
  });

  registerWebSocket(app, db, config, tickets, storage);
  serveWeb(app);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: '请求参数无效', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    request.log.error({ err: error }, 'request failed');
    return reply.code(status >= 400 && status < 500 ? status : 500).send({ error: status >= 500 ? '服务器内部错误' : error.message });
  });
  app.addHook('onClose', async () => db.close());
  const sweep = setInterval(() => { tickets.sweep(); auth.cleanup(); storage.cleanupStaleUploads(); }, 60 * 60 * 1000); sweep.unref();
  return app;
}

function serveWeb(app: FastifyInstance) {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (!fs.existsSync(webRoot)) return;
  app.get('/', (_request, reply) => reply.type('text/html').send(fs.createReadStream(path.join(webRoot, 'index.html'))));
  app.get('/assets/:file', (request, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[A-Za-z0-9_.-]+$/) }).parse(request.params);
    const asset = path.join(webRoot, 'assets', file);
    if (!fs.existsSync(asset) || !fs.statSync(asset).isFile()) return reply.code(404).send({ error: '资源不存在' });
    const extension = path.extname(file); const contentType = extension === '.js' ? 'text/javascript; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type(contentType).send(fs.createReadStream(asset));
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws') || request.url.startsWith('/assets/')) return reply.code(404).send({ error: '接口或资源不存在' });
    return reply.type('text/html').send(fs.createReadStream(path.join(webRoot, 'index.html')));
  });
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply, auth: AuthService): Promise<AuthUser | null> {
  const token = bearer(request.headers.authorization);
  if (!token) { void reply.code(401).send({ error: '需要登录' }); return null; }
  try { return await auth.verifyAccess(token); } catch { void reply.code(401).send({ error: '访问令牌无效、已过期或会话已撤销' }); return null; }
}
async function requireAdmin(request: FastifyRequest, reply: FastifyReply, auth: AuthService) {
  const user = await requireAuth(request, reply, auth); if (!user) return null;
  if (user.role !== 'admin') { void reply.code(403).send({ error: '需要管理员权限' }); return null; }
  return user;
}
async function issueSession(auth: AuthService, user: AuthUser, reply: FastifyReply, config: Config, context: SessionContext, refresh = auth.createRefresh(user.id, context)) {
  reply.setCookie('sft_refresh', refresh, { httpOnly: true, secure: config.TLS_ENABLED, sameSite: 'strict', path: '/api/auth', maxAge: 7 * 24 * 60 * 60 });
  return { accessToken: await auth.accessToken(user), expiresIn: 900, user: { username: user.username, role: user.role } };
}
function clearRefresh(reply: FastifyReply, config: Config) { reply.clearCookie('sft_refresh', { httpOnly: true, secure: config.TLS_ENABLED, sameSite: 'strict', path: '/api/auth' }); }
function sessionContext(request: FastifyRequest): SessionContext { return { ip: request.ip, userAgent: request.headers['user-agent'] }; }
function toUser(row: LoginRow): AuthUser { return { id: row.id, username: row.username, role: row.role, sessionVersion: row.password_changed_at }; }
function isFuture(value: string | null | undefined) { return Boolean(value && Date.parse(value) > Date.now()); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function activeAdminCount(db: Db) { return (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='active'").get() as {count: number}).count; }
function publicFile(file: {id: string; display_name: string; size: number; sha256: string; created_at: string; version: number}) { return { id: file.id, name: file.display_name, size: file.size, sha256: file.sha256, createdAt: file.created_at, version: file.version }; }

function recordLoginFailure(db: Db, username: string, ip: string, row?: LoginRow) {
  const attempt = db.prepare('SELECT failed_count FROM auth_attempts WHERE username=? AND ip=?').get(username, ip) as {failed_count: number} | undefined;
  const count = (attempt?.failed_count ?? 0) + 1;
  const lockSeconds = count < 5 ? 0 : Math.min(3600, 30 * 2 ** Math.min(7, count - 5));
  const lockedUntil = lockSeconds ? new Date(Date.now() + lockSeconds * 1000).toISOString() : null;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO auth_attempts(username,ip,failed_count,locked_until,last_failed_at) VALUES(?,?,?,?,?)
      ON CONFLICT(username,ip) DO UPDATE SET failed_count=excluded.failed_count,locked_until=excluded.locked_until,last_failed_at=excluded.last_failed_at`)
      .run(username, ip, count, lockedUntil, now);
    if (row) {
      const globalCount = row.failed_login_count + 1;
      const globalSeconds = globalCount < 8 ? 0 : Math.min(3600, 30 * 2 ** Math.min(7, globalCount - 8));
      db.prepare('UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?').run(globalCount, globalSeconds ? new Date(Date.now() + globalSeconds * 1000).toISOString() : row.locked_until, row.id);
    }
  })();
}
