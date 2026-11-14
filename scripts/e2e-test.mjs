import crypto from 'node:crypto';
import https from 'node:https';
import WebSocket from 'ws';

const base = 'https://localhost:8443';
const username = `e2e_${Date.now().toString(36)}`;
const password = 'E2E-Strong-Pass-123!';

function api(path, method = 'GET', body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = https.request(`${base}${path}`, { method, rejectUnauthorized: false, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if ((response.statusCode ?? 500) >= 400) reject(new Error(`${response.statusCode}: ${parsed.error ?? 'request failed'}`));
        else resolve(parsed);
      });
    });
    request.on('error', reject); if (data) request.write(data); request.end();
  });
}

class Channel {
  queue = []; waiters = [];
  constructor(socket) {
    this.socket = socket;
    socket.on('message', (data, binary) => this.push(binary ? decode(data) : { header: JSON.parse(data.toString()) }));
  }
  push(value) {
    const index = this.waiters.findIndex((entry) => entry.predicate(value));
    if (index < 0) this.queue.push(value); else this.waiters.splice(index, 1)[0].resolve(value);
  }
  next(predicate) {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), 30_000);
      this.waiters.push({ predicate, resolve: (value) => { clearTimeout(timer); resolve(value); } });
    });
  }
  sendJson(value) { this.socket.send(JSON.stringify(value)); }
  sendBinary(header, payload) { this.socket.send(encode(header, payload)); }
}

function encode(header, payload) {
  const head = Buffer.from(JSON.stringify(header));
  const frame = Buffer.alloc(4 + head.length + payload.length);
  frame.writeUInt32BE(head.length); head.copy(frame, 4); payload.copy(frame, 4 + head.length); return frame;
}
function decode(frame) {
  const length = frame.readUInt32BE(0); return { header: JSON.parse(frame.subarray(4, 4 + length).toString()), payload: frame.subarray(4 + length) };
}
function id() { return crypto.randomUUID(); }
async function connect(token) {
  const { ticket } = await api('/api/ws-ticket', 'POST', undefined, token);
  const socket = new WebSocket(`wss://localhost:8443/ws?ticket=${encodeURIComponent(ticket)}`, { rejectUnauthorized: false });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const channel = new Channel(socket); await channel.next((item) => item.header.type === 'WELCOME'); return channel;
}

const session = await api('/api/auth/register', 'POST', { username, password });
const token = session.accessToken;
const source = crypto.randomBytes(2 * 1024 * 1024 + 12345);
const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
const upload = await connect(token);
const initRequest = id();
upload.sendJson({ v: 1, type: 'UPLOAD_INIT', requestId: initRequest, name: 'e2e-random.bin', size: source.length, sha256: sourceHash, chunkSize: 1024 * 1024 });
const ready = (await upload.next((item) => item.header.requestId === initRequest && item.header.type === 'UPLOAD_READY')).header;
for (const index of ready.missingChunks) {
  const offset = index * ready.chunkSize; const payload = source.subarray(offset, offset + ready.chunkSize); const requestId = id();
  upload.sendBinary({ v: 1, type: 'UPLOAD_CHUNK', requestId, uploadId: ready.uploadId, index, offset, size: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex') }, payload);
  await upload.next((item) => item.header.requestId === requestId && item.header.type === 'CHUNK_ACK');
}
const completeRequest = id(); upload.sendJson({ v: 1, type: 'UPLOAD_COMPLETE', requestId: completeRequest, uploadId: ready.uploadId });
const file = (await upload.next((item) => item.header.requestId === completeRequest && item.header.type === 'UPLOAD_DONE')).header.file;
upload.socket.close();

const download = await connect(token); const downloadRequest = id();
download.sendJson({ v: 1, type: 'DOWNLOAD_INIT', requestId: downloadRequest, fileId: file.id, chunkSize: 1024 * 1024, offset: 0 });
await download.next((item) => item.header.requestId === downloadRequest && item.header.type === 'DOWNLOAD_META');
const received = [];
while (received.reduce((sum, chunk) => sum + chunk.length, 0) < source.length) {
  const item = await download.next((entry) => entry.header.requestId === downloadRequest && entry.header.type === 'DOWNLOAD_CHUNK');
  const chunkHash = crypto.createHash('sha256').update(item.payload).digest('hex');
  if (chunkHash !== item.header.sha256) throw new Error('download chunk hash mismatch');
  received.push(item.payload);
}
await download.next((item) => item.header.requestId === downloadRequest && item.header.type === 'DOWNLOAD_DONE');
download.socket.close();
const result = Buffer.concat(received);
if (!result.equals(source) || crypto.createHash('sha256').update(result).digest('hex') !== sourceHash) throw new Error('end-to-end file mismatch');
await api(`/api/files/${file.id}`, 'DELETE', undefined, token);
console.log(`E2E PASS: ${source.length} bytes, 3 chunks, SHA-256 ${sourceHash}`);

