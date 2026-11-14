import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { wsTicket, type RemoteFile } from './api';

export const CHUNK_SIZE = 1024 * 1024;
export interface TransferProgress { completed: number; total: number; percent: number; status: string }

type Message = Record<string, unknown> & { type: string; requestId?: string };
type InboxItem = { value: Message; payload?: Uint8Array };

export async function hashFile(file: Blob, onProgress?: (value: number) => void): Promise<string> {
  const hash = sha256.create();
  const stride = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += stride) {
    hash.update(new Uint8Array(await file.slice(offset, offset + stride).arrayBuffer()));
    onProgress?.(Math.min(1, (offset + stride) / Math.max(file.size, 1)));
  }
  return bytesToHex(hash.digest());
}

export function encodeFrame(header: Message, payload: Uint8Array): ArrayBuffer {
  const head = new TextEncoder().encode(JSON.stringify(header));
  if (head.length > 16 * 1024) throw new Error('协议头过大');
  const frame = new Uint8Array(4 + head.length + payload.length);
  new DataView(frame.buffer).setUint32(0, head.length, false);
  frame.set(head, 4); frame.set(payload, 4 + head.length);
  return frame.buffer;
}

export function decodeFrame(buffer: ArrayBuffer): InboxItem {
  if (buffer.byteLength < 5) throw new Error('收到无效二进制帧');
  const headerLength = new DataView(buffer).getUint32(0, false);
  if (headerLength < 2 || headerLength > 16 * 1024 || 4 + headerLength > buffer.byteLength) throw new Error('协议头长度无效');
  const value = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Message;
  return { value, payload: new Uint8Array(buffer, 4 + headerLength) };
}

class Channel {
  private socket!: WebSocket;
  private queue: InboxItem[] = [];
  private waiters: Array<{predicate: (item: InboxItem) => boolean; resolve: (item: InboxItem) => void; reject: (error: Error) => void; timer: number}> = [];

  async open() {
    const ticket = await wsTicket();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${scheme}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onmessage = (event) => this.push(typeof event.data === 'string' ? { value: JSON.parse(event.data) as Message } : decodeFrame(event.data as ArrayBuffer));
    this.socket.onclose = () => this.fail(new Error('安全连接已关闭'));
    this.socket.onerror = () => this.fail(new Error('安全连接发生错误'));
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('连接服务器超时')), 10_000);
      this.socket.onopen = () => { clearTimeout(timer); resolve(); };
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接服务器')); }, { once: true });
    });
    await this.wait((item) => item.value.type === 'WELCOME');
  }
  send(value: object | ArrayBuffer) { this.socket.send(value instanceof ArrayBuffer ? value : JSON.stringify(value)); }
  wait(predicate: (item: InboxItem) => boolean, timeout = 60_000): Promise<InboxItem> {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.waiters = this.waiters.filter((w) => w.timer !== timer); reject(new Error('等待服务器响应超时')); }, timeout);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }
  close() { if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, 'complete'); }
  private push(item: InboxItem) {
    if (item.value.type === 'ERROR') { this.fail(new Error(String(item.value.message ?? '服务器拒绝了请求'))); return; }
    const index = this.waiters.findIndex((w) => w.predicate(item));
    if (index < 0) { this.queue.push(item); return; }
    const waiter = this.waiters.splice(index, 1)[0]!; clearTimeout(waiter.timer); waiter.resolve(item);
  }
  private fail(error: Error) { for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); } }
}

function requestId() { return crypto.randomUUID(); }
function isResponse(item: InboxItem, id: string, type: string) { return item.value.requestId === id && item.value.type === type; }

export async function uploadFile(file: File, progress: (p: TransferProgress) => void): Promise<RemoteFile> {
  progress({ completed: 0, total: file.size, percent: 0, status: '正在计算 SHA-256…' });
  const fileHash = await hashFile(file, (value) => progress({ completed: value * file.size, total: file.size, percent: value * 10, status: '正在计算 SHA-256…' }));
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const channel = new Channel();
    try {
      progress({ completed: 0, total: file.size, percent: 10, status: attempt > 1 ? `连接恢复（第 ${attempt} 次）…` : '建立安全连接…' });
      await channel.open();
      const initId = requestId();
      channel.send({ v: 1, type: 'UPLOAD_INIT', requestId: initId, name: file.name, size: file.size, sha256: fileHash, chunkSize: CHUNK_SIZE });
      const ready = (await channel.wait((item) => isResponse(item, initId, 'UPLOAD_READY'))).value;
      const uploadId = String(ready.uploadId);
      const chunkSize = Number(ready.chunkSize);
      const missing = ready.missingChunks as number[];
      let completed = file.size - missing.reduce((sum, index) => sum + Math.min(chunkSize, file.size - index * chunkSize), 0);
      for (const index of missing) {
        const offset = index * chunkSize;
        const payload = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        const id = requestId();
        channel.send(encodeFrame({ v: 1, type: 'UPLOAD_CHUNK', requestId: id, uploadId, index, offset, size: payload.length, sha256: bytesToHex(sha256(payload)) }, payload));
        await channel.wait((item) => isResponse(item, id, 'CHUNK_ACK'));
        completed += payload.length;
        progress({ completed, total: file.size, percent: 10 + completed / Math.max(file.size, 1) * 85, status: ready.resumed ? '断点续传中…' : '加密传输中…' });
      }
      const completeId = requestId();
      channel.send({ v: 1, type: 'UPLOAD_COMPLETE', requestId: completeId, uploadId });
      const done = (await channel.wait((item) => isResponse(item, completeId, 'UPLOAD_DONE'), 120_000)).value;
      progress({ completed: file.size, total: file.size, percent: 100, status: '完整性校验通过' });
      channel.close();
      return done.file as unknown as RemoteFile;
    } catch (error) {
      channel.close(); lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('上传失败');
}

export async function downloadFile(file: RemoteFile, progress: (p: TransferProgress) => void) {
  type PickerWindow = Window & { showSaveFilePicker?: (options: {suggestedName: string}) => Promise<FileSystemFileHandle> };
  const picker = (window as PickerWindow).showSaveFilePicker;
  let writable: FileSystemWritableFileStream | null = null;
  const pieces: Uint8Array[] = [];
  if (picker) {
    const handle = await picker({ suggestedName: file.name });
    writable = await handle.createWritable();
  } else if (file.size > 256 * 1024 * 1024) {
    throw new Error('当前浏览器不支持流式写盘；为避免内存耗尽，请使用最新版 Chromium 浏览器下载大文件');
  }
  const wholeHash = sha256.create();
  let received = 0;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= 3 && received <= file.size; attempt += 1) {
      const channel = new Channel();
      try {
        progress({ completed: received, total: file.size, percent: received / Math.max(file.size, 1) * 100, status: attempt > 1 ? `正在恢复下载（第 ${attempt} 次）…` : '建立安全连接…' });
        await channel.open();
        const id = requestId();
        channel.send({ v: 1, type: 'DOWNLOAD_INIT', requestId: id, fileId: file.id, chunkSize: CHUNK_SIZE, offset: received });
        await channel.wait((item) => isResponse(item, id, 'DOWNLOAD_META'));
        while (received < file.size) {
          const item = await channel.wait((entry) => entry.value.requestId === id && entry.value.type === 'DOWNLOAD_CHUNK', 120_000);
          const payload = item.payload!;
          if (bytesToHex(sha256(payload)) !== item.value.sha256) throw new Error('下载分块完整性校验失败');
          if (Number(item.value.offset) !== received) throw new Error('下载分块顺序异常');
          const copy = new Uint8Array(payload);
          if (writable) await writable.write(copy); else pieces.push(copy);
          wholeHash.update(copy); received += copy.length;
          progress({ completed: received, total: file.size, percent: received / Math.max(file.size, 1) * 100, status: '流式写盘并校验中…' });
        }
        await channel.wait((item) => isResponse(item, id, 'DOWNLOAD_DONE'));
        channel.close(); lastError = undefined; break;
      } catch (error) {
        channel.close(); lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (lastError) throw lastError;
    if (bytesToHex(wholeHash.digest()) !== file.sha256) throw new Error('整文件 SHA-256 校验失败');
    if (writable) await writable.close();
    else {
      const blob = new Blob(pieces as BlobPart[], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    progress({ completed: file.size, total: file.size, percent: 100, status: '下载完成，哈希校验通过' });
  } catch (error) {
    if (writable) await writable.abort().catch(() => undefined);
    throw error;
  }
}

