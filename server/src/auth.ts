import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Db } from './db.js';
import { randomToken, sha256Text } from './security.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
  sessionVersion: string;
}
export interface SessionContext { ip?: string; userAgent?: string }

interface UserRow {
  id: string; username: string; role: 'user' | 'admin'; status: 'active' | 'disabled'; password_changed_at: string;
}
interface RefreshRow extends UserRow {
  family_id: string; expires_at: string; used_at: string | null; revoked_at: string | null;
}

export class AuthService {
  private readonly key: Uint8Array;
  constructor(private readonly db: Db, secret: string) { this.key = new TextEncoder().encode(secret); }

  async accessToken(user: AuthUser): Promise<string> {
    return new SignJWT({ sv: user.sessionVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id).setIssuer('sft-server').setAudience('sft-web')
      .setIssuedAt().setExpirationTime('15m').sign(this.key);
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, this.key, { issuer: 'sft-server', audience: 'sft-web', algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.sv !== 'string') throw new Error('令牌内容无效');
    const row = this.db.prepare('SELECT id,username,role,status,password_changed_at FROM users WHERE id=?').get(payload.sub) as UserRow | undefined;
    if (!row || row.status !== 'active' || row.password_changed_at !== payload.sv) throw new Error('会话已撤销');
    return toAuthUser(row);
  }

  createRefresh(userId: string, context: SessionContext = {}, familyId = crypto.randomUUID()): string {
    const token = randomToken(48);
    const now = new Date();
    this.db.prepare(`INSERT INTO refresh_tokens(token_hash,user_id,family_id,expires_at,created_at,ip,user_agent)
      VALUES(?,?,?,?,?,?,?)`).run(sha256Text(token), userId, familyId, new Date(now.getTime() + 7 * 86_400_000).toISOString(), now.toISOString(), context.ip ?? null, context.userAgent?.slice(0, 300) ?? null);
    return token;
  }

  rotateRefresh(token: string, context: SessionContext = {}): { user: AuthUser; token: string } | null {
    const hash = sha256Text(token);
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT u.id,u.username,u.role,u.status,u.password_changed_at,
        r.family_id,r.expires_at,r.used_at,r.revoked_at
        FROM refresh_tokens r JOIN users u ON u.id=r.user_id WHERE r.token_hash=?`).get(hash) as RefreshRow | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      if (row.used_at || row.revoked_at) {
        this.db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?').run(now, row.family_id);
        return null;
      }
      if (row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) {
        this.db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?').run(now, row.family_id);
        return null;
      }
      const replacement = randomToken(48);
      const replacementHash = sha256Text(replacement);
      this.db.prepare('UPDATE refresh_tokens SET used_at=?,replaced_by_hash=? WHERE token_hash=?').run(now, replacementHash, hash);
      this.db.prepare(`INSERT INTO refresh_tokens(token_hash,user_id,family_id,expires_at,created_at,ip,user_agent)
        VALUES(?,?,?,?,?,?,?)`).run(replacementHash, row.id, row.family_id, new Date(Date.now() + 7 * 86_400_000).toISOString(), now, context.ip ?? null, context.userAgent?.slice(0, 300) ?? null);
      return { user: toAuthUser(row), token: replacement };
    }).immediate();
  }

  revokeRefresh(token: string) {
    const hash = sha256Text(token);
    const now = new Date().toISOString();
    const row = this.db.prepare('SELECT family_id FROM refresh_tokens WHERE token_hash=?').get(hash) as {family_id: string} | undefined;
    if (row) this.db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?').run(now, row.family_id);
  }
  revokeAll(userId: string) { this.db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(new Date().toISOString(), userId); }
  cleanup() { this.db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(new Date(Date.now() - 86_400_000).toISOString()); }
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, role: row.role, sessionVersion: row.password_changed_at };
}

export class TicketStore {
  private tickets = new Map<string, { user: AuthUser; expires: number }>();
  issue(user: AuthUser): string {
    const ticket = randomToken();
    this.tickets.set(sha256Text(ticket), { user, expires: Date.now() + 30_000 });
    return ticket;
  }
  consume(ticket: string): AuthUser | null {
    const key = sha256Text(ticket); const record = this.tickets.get(key); this.tickets.delete(key);
    if (!record || record.expires < Date.now()) return null;
    return record.user;
  }
  sweep() { const now = Date.now(); for (const [k, v] of this.tickets) if (v.expires < now) this.tickets.delete(k); }
}

export function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}
