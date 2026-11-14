import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';

const cleanup: string[] = [];
afterEach(() => { for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('database migration', () => {
  it('upgrades a legacy v1 database transactionally without losing users', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sft-migrate-')); cleanup.push(dir);
    const legacy = new Database(path.join(dir, 'sft.sqlite'));
    legacy.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',bandwidth_bps INTEGER,created_at TEXT NOT NULL);
      CREATE TABLE refresh_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE files(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),display_name TEXT NOT NULL,storage_name TEXT NOT NULL UNIQUE,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,event TEXT NOT NULL,detail TEXT NOT NULL,ip TEXT,created_at TEXT NOT NULL);
      INSERT INTO users(id,username,password_hash,role,created_at) VALUES('u1','legacy','hash','user','2026-01-01T00:00:00.000Z');
    `);
    legacy.close();
    const upgraded = createDatabase(dir);
    const user = upgraded.prepare('SELECT username,status,password_changed_at,storage_quota_bytes FROM users WHERE id=\'u1\'').get() as {username: string; status: string; password_changed_at: string; storage_quota_bytes: number};
    expect(user).toEqual({ username: 'legacy', status: 'active', password_changed_at: '2026-01-01T00:00:00.000Z', storage_quota_bytes: 2 * 1024 ** 3 });
    expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {version: number}).version).toBe(2);
    upgraded.close();
  });
});
