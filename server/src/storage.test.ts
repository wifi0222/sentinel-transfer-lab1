import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { StorageService } from './storage.js';

const cleanup: string[] = [];
afterEach(() => { for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(maxActive = 5) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sft-storage-')); cleanup.push(dir);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, TLS_ENABLED: 'false', MTLS_ENABLED: 'false', JWT_SECRET: 'storage-test-secret-with-at-least-32-characters', MAX_FILE_BYTES: '10485760', DEFAULT_STORAGE_QUOTA_BYTES: '10485760', MIN_FREE_DISK_BYTES: '0', MAX_ACTIVE_UPLOADS_PER_USER: String(maxActive) });
  const db = createDatabase(dir); const now = new Date().toISOString(); const userId = crypto.randomUUID();
  db.prepare(`INSERT INTO users(id,username,password_hash,role,created_at,status,password_changed_at,storage_quota_bytes)
    VALUES(?,?,?,'user',?,'active',?,?)`).run(userId, 'storage-user', 'unused', now, now, 10 * 1024 * 1024);
  return { db, userId, storage: new StorageService(db, config) };
}

describe('storage safety policy', () => {
  it('reserves quota before creating an upload', async () => {
    const { db, userId, storage } = setup();
    db.prepare('UPDATE users SET storage_quota_bytes=? WHERE id=?').run(1024 * 1024, userId);
    await expect(storage.initUpload(userId, 'too-large.bin', 2 * 1024 * 1024, 'a'.repeat(64), 1024 * 1024)).rejects.toThrow(/配额/);
    expect((db.prepare('SELECT COUNT(*) AS count FROM uploads').get() as {count: number}).count).toBe(0);
    db.close();
  });

  it('limits concurrent upload reservations per user', async () => {
    const { db, userId, storage } = setup(1);
    await storage.initUpload(userId, 'first.bin', 1024, 'a'.repeat(64), 1024);
    await expect(storage.initUpload(userId, 'second.bin', 1024, 'b'.repeat(64), 1024)).rejects.toThrow(/会话数量/);
    db.close();
  });

  it('keeps same-name uploads as explicit non-destructive versions', async () => {
    const { db, userId, storage } = setup();
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const first = await storage.initUpload(userId, 'report.txt', 0, emptyHash, 1024);
    expect((await storage.completeUpload(userId, first.uploadId)).version).toBe(1);
    const second = await storage.initUpload(userId, 'report.txt', 0, emptyHash, 1024);
    expect((await storage.completeUpload(userId, second.uploadId)).version).toBe(2);
    expect(storage.listFiles(userId).map((f) => f.version).sort()).toEqual([1, 2]);
    db.close();
  });
});
