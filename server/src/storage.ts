import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { audit } from './db.js';
import { safeDisplayName } from './security.js';
import type { ChunkHeader } from './protocol.js';

interface UploadRow {
  id: string; user_id: string; display_name: string; temp_name: string; size: number;
  sha256: string; chunk_size: number; total_chunks: number;
}

export interface FileRow {
  id: string; user_id: string; display_name: string; storage_name: string;
  size: number; sha256: string; created_at: string; version: number;
}

export class StorageService {
  private readonly filesDir: string;
  private readonly tempDir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly db: Db, private readonly config: Config) {
    this.filesDir = path.join(config.dataDir, 'files');
    this.tempDir = path.join(config.dataDir, 'uploads');
    fs.mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.tempDir, { recursive: true, mode: 0o700 });
  }

  async initUpload(userId: string, name: string, size: number, sha256: string, chunkSize: number) {
    if (size > this.config.MAX_FILE_BYTES) throw new Error(`文件超过 ${this.config.MAX_FILE_BYTES} 字节上限`);
    const displayName = safeDisplayName(name);
    let row = this.db.prepare('SELECT * FROM uploads WHERE user_id=? AND display_name=? AND size=? AND sha256=?')
      .get(userId, displayName, size, sha256) as UploadRow | undefined;
    if (row && !fs.existsSync(this.tempPath(row.temp_name))) {
      this.db.prepare('DELETE FROM uploads WHERE id=?').run(row.id);
      row = undefined;
    }
    if (!row) {
      const id = crypto.randomUUID();
      const tempName = `${crypto.randomUUID()}.part`;
      const totalChunks = size === 0 ? 0 : Math.ceil(size / chunkSize);
      row = { id, user_id: userId, display_name: displayName, temp_name: tempName, size, sha256, chunk_size: chunkSize, total_chunks: totalChunks };
      try {
        this.db.transaction(() => {
          const user = this.db.prepare('SELECT storage_quota_bytes FROM users WHERE id=? AND status=\'active\'').get(userId) as {storage_quota_bytes: number} | undefined;
          if (!user) throw new Error('上传账户不可用');
          const used = (this.db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM files WHERE user_id=?').get(userId) as {total: number}).total;
          const reserved = (this.db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM uploads WHERE user_id=?').get(userId) as {total: number}).total;
          const active = (this.db.prepare('SELECT COUNT(*) AS count FROM uploads WHERE user_id=?').get(userId) as {count: number}).count;
          if (active >= this.config.MAX_ACTIVE_UPLOADS_PER_USER) throw new Error('上传会话数量已达上限，请先完成或等待旧会话清理');
          if (used + reserved + size > user.storage_quota_bytes) throw new Error('文件会使账户存储配额超限');
          const disk = fs.statfsSync(this.tempDir);
          const free = Number(disk.bavail) * Number(disk.bsize);
          if (free - this.config.MIN_FREE_DISK_BYTES < size) throw new Error('服务器可用磁盘空间不足，已保留安全余量');
          this.db.prepare(`INSERT INTO uploads(id,user_id,display_name,temp_name,size,sha256,chunk_size,total_chunks,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(id, userId, displayName, tempName, size, sha256, chunkSize, totalChunks, new Date().toISOString());
        }).immediate();
        const handle = await fs.promises.open(this.tempPath(tempName), 'wx', 0o600);
        try { await handle.truncate(size); } finally { await handle.close(); }
      } catch (error) {
        this.db.prepare('DELETE FROM uploads WHERE id=?').run(id);
        await fs.promises.rm(this.tempPath(tempName), { force: true });
        throw error;
      }
      audit(this.db, 'upload.created', { uploadId: id, displayName, size }, userId);
    }
    const received = this.db.prepare('SELECT chunk_index FROM upload_chunks WHERE upload_id=? ORDER BY chunk_index').all(row.id) as {chunk_index: number}[];
    const have = new Set(received.map((item) => item.chunk_index));
    const missing: number[] = [];
    for (let index = 0; index < row.total_chunks; index += 1) if (!have.has(index)) missing.push(index);
    return { uploadId: row.id, chunkSize: row.chunk_size, totalChunks: row.total_chunks, missingChunks: missing, resumed: received.length > 0 };
  }

  async acceptChunk(userId: string, header: ChunkHeader, payload: Buffer): Promise<void> {
    await this.serial(header.uploadId, async () => {
      const row = this.ownedUpload(header.uploadId, userId);
      if (header.index >= row.total_chunks) throw new Error('分块序号超出范围');
      const expectedOffset = header.index * row.chunk_size;
      const expectedSize = Math.min(row.chunk_size, row.size - expectedOffset);
      if (header.offset !== expectedOffset || header.size !== expectedSize || payload.length !== expectedSize) throw new Error('分块偏移或长度无效');
      const actualHash = crypto.createHash('sha256').update(payload).digest('hex');
      if (actualHash !== header.sha256) throw new Error('分块哈希校验失败');
      const existing = this.db.prepare('SELECT chunk_sha256,size FROM upload_chunks WHERE upload_id=? AND chunk_index=?').get(row.id, header.index) as {chunk_sha256: string; size: number} | undefined;
      if (existing) {
        if (existing.chunk_sha256 !== actualHash || existing.size !== payload.length) throw new Error('分块重传内容不一致');
        return;
      }
      const handle = await fs.promises.open(this.tempPath(row.temp_name), 'r+');
      try { await writeAll(handle, payload, expectedOffset); await handle.sync(); } finally { await handle.close(); }
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO upload_chunks(upload_id,chunk_index,chunk_sha256,size) VALUES(?,?,?,?)').run(row.id, header.index, actualHash, payload.length);
        this.db.prepare('UPDATE uploads SET updated_at=? WHERE id=?').run(new Date().toISOString(), row.id);
      })();
    });
  }

  async completeUpload(userId: string, uploadId: string): Promise<FileRow> {
    return this.serial(uploadId, async () => {
      const row = this.ownedUpload(uploadId, userId);
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM upload_chunks WHERE upload_id=?').get(uploadId) as {count: number}).count;
      if (count !== row.total_chunks) throw new Error(`仍有 ${row.total_chunks - count} 个分块未收到`);
      const tempPath = this.tempPath(row.temp_name);
      const stat = await fs.promises.stat(tempPath);
      if (stat.size !== row.size) throw new Error('临时文件大小不一致');
      const actualHash = await hashFile(tempPath);
      if (actualHash !== row.sha256) throw new Error('整文件 SHA-256 校验失败');

      const fileId = crypto.randomUUID();
      const storageName = `${crypto.randomUUID()}.bin`;
      const finalPath = this.filePath(storageName);
      await fs.promises.rename(tempPath, finalPath);
      const file: FileRow = { id: fileId, user_id: userId, display_name: row.display_name, storage_name: storageName, size: row.size, sha256: row.sha256, created_at: new Date().toISOString(), version: 1 };
      try {
        this.db.transaction(() => {
          file.version = (this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM files WHERE user_id=? AND display_name=?').get(userId, row.display_name) as {version: number}).version;
          this.db.prepare('INSERT INTO files(id,user_id,display_name,storage_name,size,sha256,created_at,version) VALUES(?,?,?,?,?,?,?,?)')
            .run(file.id, file.user_id, file.display_name, file.storage_name, file.size, file.sha256, file.created_at, file.version);
          this.db.prepare('DELETE FROM uploads WHERE id=?').run(uploadId);
        }).immediate();
      } catch (error) {
        await fs.promises.rename(finalPath, tempPath).catch(() => undefined);
        throw error;
      }
      audit(this.db, 'upload.completed', { fileId, displayName: file.display_name, size: file.size }, userId);
      return file;
    }) as Promise<FileRow>;
  }

  listFiles(userId: string): FileRow[] {
    return this.db.prepare('SELECT * FROM files WHERE user_id=? ORDER BY created_at DESC').all(userId) as FileRow[];
  }

  ownedFile(fileId: string, userId: string): FileRow {
    const row = this.db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(fileId, userId) as FileRow | undefined;
    if (!row) throw new Error('文件不存在或无权访问');
    return row;
  }

  openFile(row: FileRow) { return fs.promises.open(this.filePath(row.storage_name), 'r'); }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const row = this.ownedFile(fileId, userId);
    const source = this.filePath(row.storage_name);
    const trash = `${source}.delete-${crypto.randomUUID()}`;
    await fs.promises.rename(source, trash);
    try {
      this.db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(fileId, userId);
      await fs.promises.rm(trash, { force: true });
      audit(this.db, 'file.deleted', { fileId, displayName: row.display_name }, userId);
    } catch (error) {
      await fs.promises.rename(trash, source).catch(() => undefined);
      throw error;
    }
  }

  cleanupStaleUploads(maxAgeMs = 48 * 60 * 60 * 1000): void {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stale = this.db.prepare('SELECT id,temp_name FROM uploads WHERE updated_at < ?').all(cutoff) as {id: string; temp_name: string}[];
    for (const row of stale) {
      this.db.prepare('DELETE FROM uploads WHERE id=?').run(row.id);
      fs.rmSync(this.tempPath(row.temp_name), { force: true });
    }
  }

  private ownedUpload(uploadId: string, userId: string): UploadRow {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id=? AND user_id=?').get(uploadId, userId) as UploadRow | undefined;
    if (!row) throw new Error('上传会话不存在或无权访问');
    return row;
  }
  private tempPath(name: string) { return path.join(this.tempDir, name); }
  private filePath(name: string) { return path.join(this.filesDir, name); }
  private serial<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(job);
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }
}

async function writeAll(handle: FileHandle, data: Buffer, position: number) {
  let written = 0;
  while (written < data.length) {
    const result = await handle.write(data, written, data.length - written, position + written);
    if (result.bytesWritten <= 0) throw new Error('磁盘写入失败');
    written += result.bytesWritten;
  }
}

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

