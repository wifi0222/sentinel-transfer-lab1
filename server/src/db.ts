import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      bandwidth_bps INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL CHECK(size >= 0),
      sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_files_user_created ON files(user_id, created_at DESC);
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      temp_name TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL CHECK(size >= 0),
      sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
      chunk_size INTEGER NOT NULL CHECK(chunk_size > 0),
      total_chunks INTEGER NOT NULL CHECK(total_chunks >= 0),
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, display_name, size, sha256)
    );
    CREATE TABLE upload_chunks (
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY(upload_id, chunk_index)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      event TEXT NOT NULL,
      detail TEXT NOT NULL,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_audit_user_time ON audit_log(user_id, created_at DESC);
  ` },
  { version: 2, sql: `
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled'));
    ALTER TABLE users ADD COLUMN password_changed_at TEXT;
    ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER NOT NULL DEFAULT 2147483648 CHECK(storage_quota_bytes >= 0);
    ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_login_count >= 0);
    ALTER TABLE users ADD COLUMN locked_until TEXT;
    UPDATE users SET password_changed_at=created_at WHERE password_changed_at IS NULL;

    DROP TABLE refresh_tokens;
    CREATE TABLE refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      replaced_by_hash TEXT,
      revoked_at TEXT,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
    CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);

    ALTER TABLE files ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
    CREATE INDEX idx_files_user_name_version ON files(user_id, display_name, version DESC);

    CREATE TABLE auth_attempts (
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_failed_at TEXT NOT NULL,
      PRIMARY KEY(username, ip)
    );

    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  ` }
];

export function createDatabase(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(dataDir, 'sft.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const usersExist = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get());
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as {version: number}[]).map((r) => r.version));
  if (usersExist && applied.size === 0) {
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
    applied.add(1);
  }
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version, new Date().toISOString());
    }).immediate();
  }
}

export function audit(db: Db, event: string, detail: unknown, userId?: string, ip?: string) {
  const serialized = JSON.stringify(detail).slice(0, 4000);
  db.prepare('INSERT INTO audit_log(user_id,event,detail,ip,created_at) VALUES(?,?,?,?,?)')
    .run(userId ?? null, event, serialized, ip ?? null, new Date().toISOString());
}
