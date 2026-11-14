import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { audit, createDatabase } from './db.js';
import { hashPassword, normalizeUsername } from './security.js';

const username = normalizeUsername(process.argv[2] ?? '');
const mode = process.argv[3] ?? '--create';

async function main(): Promise<number> {
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) return fail('管理员用户名必须为 3–32 位字母、数字、点、下划线或连字符');
  if (!['--create', '--check', '--reset-password'].includes(mode)) return fail('未知的管理员操作');

  const config = loadConfig();
  const db = createDatabase(config.dataDir);
  try {
    const existing = db.prepare('SELECT id,role,status FROM users WHERE username=?').get(username) as {id: string; role: 'user' | 'admin'; status: 'active' | 'disabled'} | undefined;

    if (mode === '--check') {
      if (!existing) return 10;
      if (existing.role !== 'admin') return fail(`用户名 ${username} 已属于普通用户；为避免账户劫持，不会自动提升该账户`, 3);
      process.stdout.write(`管理员 ${username} 已存在，无需重复创建。若忘记密码，请使用 -ResetPassword。\n`);
      return 0;
    }

    if (mode === '--create' && existing) {
      if (existing.role !== 'admin') return fail(`用户名 ${username} 已属于普通用户；请选择另一个管理员用户名`);
      process.stdout.write(`管理员 ${username} 已存在，本次未做任何修改。\n`);
      return 0;
    }
    if (mode === '--reset-password' && (!existing || existing.role !== 'admin')) {
      return fail(`管理员 ${username} 不存在，无法重置密码`);
    }

    const password = process.env.SFT_ADMIN_PASSWORD ?? '';
    if (!strongPassword(password)) return fail('管理员密码必须至少 12 位，并包含大小写字母、数字和特殊字符');
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    if (mode === '--reset-password' && existing) {
      db.transaction(() => {
        db.prepare(`UPDATE users SET password_hash=?,password_changed_at=?,status='active',failed_login_count=0,locked_until=NULL WHERE id=?`)
          .run(passwordHash, now, existing.id);
        db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now, existing.id);
      }).immediate();
      audit(db, 'admin.password_reset_local', { username, source: 'local-cli' }, existing.id, 'local');
      process.stdout.write(`管理员 ${username} 的密码已重置，所有旧会话已撤销。\n`);
      return 0;
    }

    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO users(id,username,password_hash,role,created_at,status,password_changed_at,storage_quota_bytes)
      VALUES(?,?,?,'admin',?,'active',?,?)`).run(id, username, passwordHash, now, now, config.DEFAULT_STORAGE_QUOTA_BYTES);
    audit(db, 'admin.bootstrap_created', { username, source: 'local-cli' }, id, 'local');
    process.stdout.write(`管理员 ${username} 已创建。\n`);
    return 0;
  } finally { db.close(); }
}

function strongPassword(password: string) {
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^\p{L}\p{N}]/u.test(password);
}
function fail(message: string, code = 1) { process.stderr.write(`${message}\n`); return code; }

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`管理员操作失败：${error instanceof Error ? error.message : '未知错误'}\n`);
  process.exitCode = 1;
});
