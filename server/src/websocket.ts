import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthUser, TicketStore } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { audit } from './db.js';
import { SerialRateLimiter } from './limiter.js';
import { controlMessage, decodeBinary, encodeBinary, PROTOCOL_VERSION } from './protocol.js';
import type { StorageService } from './storage.js';

export function registerWebSocket(app: FastifyInstance, db: Db, config: Config, tickets: TicketStore, storage: StorageService) {
  const connections = new Map<string, number>();
  app.get('/ws', { websocket: true }, (socket, request) => {
    const raw = request.query as { ticket?: string };
    const user = raw.ticket ? tickets.consume(raw.ticket) : null;
    if (!user) { socket.close(4401, 'invalid ticket'); return; }
    const currentUser = db.prepare('SELECT status,password_changed_at FROM users WHERE id=?').get(user.id) as {status: string; password_changed_at: string} | undefined;
    if (!currentUser || currentUser.status !== 'active' || currentUser.password_changed_at !== user.sessionVersion) { socket.close(4401, 'session revoked'); return; }
    const current = connections.get(user.id) ?? 0;
    if (current >= config.MAX_WS_CONNECTIONS_PER_USER) { socket.close(4429, 'too many connections'); return; }
    connections.set(user.id, current + 1);
    audit(db, 'ws.connected', {}, user.id, request.ip);

    const userBps = (db.prepare('SELECT bandwidth_bps FROM users WHERE id=?').get(user.id) as {bandwidth_bps: number | null} | undefined)?.bandwidth_bps;
    const uploadLimiter = new SerialRateLimiter(userBps ?? config.UPLOAD_BYTES_PER_SECOND);
    const downloadLimiter = new SerialRateLimiter(userBps ?? config.DOWNLOAD_BYTES_PER_SECOND);
    let chain = Promise.resolve();
    let alive = true;
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false; socket.ping();
    }, 30_000);

    socket.on('message', (rawData, isBinary) => {
      chain = chain.then(async () => {
        if (isBinary) {
          const { header, payload } = decodeBinary(Buffer.from(rawData as ArrayBuffer));
          await uploadLimiter.consume(payload.length);
          await storage.acceptChunk(user.id, header, payload);
          sendJson(socket, { v: PROTOCOL_VERSION, type: 'CHUNK_ACK', requestId: header.requestId, uploadId: header.uploadId, index: header.index });
          return;
        }
        const parsed = controlMessage.parse(JSON.parse(rawData.toString()));
        if (parsed.type === 'UPLOAD_INIT') {
          const result = await storage.initUpload(user.id, parsed.name, parsed.size, parsed.sha256, parsed.chunkSize);
          sendJson(socket, { v: PROTOCOL_VERSION, type: 'UPLOAD_READY', requestId: parsed.requestId, ...result });
        } else if (parsed.type === 'UPLOAD_COMPLETE') {
          const file = await storage.completeUpload(user.id, parsed.uploadId);
          sendJson(socket, { v: PROTOCOL_VERSION, type: 'UPLOAD_DONE', requestId: parsed.requestId, file: publicFile(file) });
        } else if (parsed.type === 'DOWNLOAD_INIT') {
          await sendDownload(socket, user, parsed, storage, downloadLimiter);
        } else {
          sendJson(socket, { v: PROTOCOL_VERSION, type: 'PONG', requestId: parsed.requestId, timestamp: parsed.timestamp });
        }
      }).catch((error: unknown) => {
        const message = publicError(error);
        request.log.warn({ err: error, userId: user.id }, 'websocket message rejected');
        sendJson(socket, { v: PROTOCOL_VERSION, type: 'ERROR', code: 'REQUEST_REJECTED', message });
      });
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      connections.set(user.id, Math.max(0, (connections.get(user.id) ?? 1) - 1));
      audit(db, 'ws.disconnected', {}, user.id, request.ip);
    });
    socket.on('error', (error) => request.log.warn({ err: error, userId: user.id }, 'websocket error'));
    sendJson(socket, { v: PROTOCOL_VERSION, type: 'WELCOME', user: { username: user.username }, maxFileBytes: config.MAX_FILE_BYTES });
  });
}

async function sendDownload(socket: WebSocket, user: AuthUser, message: Extract<ReturnType<typeof controlMessage.parse>, {type: 'DOWNLOAD_INIT'}>, storage: StorageService, limiter: SerialRateLimiter) {
  const file = storage.ownedFile(message.fileId, user.id);
  if (message.offset > file.size) throw new Error('下载偏移超出文件范围');
  sendJson(socket, { v: PROTOCOL_VERSION, type: 'DOWNLOAD_META', requestId: message.requestId, file: publicFile(file), offset: message.offset, chunkSize: message.chunkSize });
  const handle = await storage.openFile(file);
  try {
    let offset = message.offset;
    let index = Math.floor(offset / message.chunkSize);
    const buffer = Buffer.allocUnsafe(message.chunkSize);
    while (offset < file.size && socket.readyState === socket.OPEN) {
      const length = Math.min(buffer.length, file.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) throw new Error('读取文件时意外结束');
      const payload = Buffer.from(buffer.subarray(0, bytesRead));
      await limiter.consume(bytesRead);
      await waitForBackpressure(socket);
      socket.send(encodeBinary({ v: PROTOCOL_VERSION, type: 'DOWNLOAD_CHUNK', requestId: message.requestId, fileId: file.id, index, offset, size: bytesRead, sha256: crypto.createHash('sha256').update(payload).digest('hex') }, payload));
      offset += bytesRead; index += 1;
    }
    sendJson(socket, { v: PROTOCOL_VERSION, type: 'DOWNLOAD_DONE', requestId: message.requestId, fileId: file.id, sha256: file.sha256 });
  } finally { await handle.close(); }
}

async function waitForBackpressure(socket: WebSocket) {
  while (socket.bufferedAmount > 8 * 1024 * 1024 && socket.readyState === socket.OPEN) await new Promise((resolve) => setTimeout(resolve, 10));
}

function sendJson(socket: WebSocket, value: object) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}

function publicFile(file: {id: string; display_name: string; size: number; sha256: string; created_at: string; version: number}) {
  return { id: file.id, name: file.display_name, size: file.size, sha256: file.sha256, createdAt: file.created_at, version: file.version };
}

function publicError(error: unknown): string {
  if (!(error instanceof Error)) return '请求处理失败';
  const safePrefixes = ['文件', '分块', '上传', '下载', '临时文件', '整文件', '仍有', '协议头', '二进制帧', '收到', '服务器'];
  return safePrefixes.some((prefix) => error.message.startsWith(prefix)) ? error.message : '请求参数无效或处理失败';
}

