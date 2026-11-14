import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MIN_CHUNK = 64 * 1024;
export const MAX_CHUNK = 4 * 1024 * 1024;
export const DEFAULT_CHUNK = 1024 * 1024;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const base = z.object({ v: z.literal(PROTOCOL_VERSION), requestId: z.string().min(8).max(80) });

export const controlMessage = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('UPLOAD_INIT'), name: z.string(), size: z.number().int().min(0), sha256, chunkSize: z.number().int().min(MIN_CHUNK).max(MAX_CHUNK).default(DEFAULT_CHUNK) }),
  base.extend({ type: z.literal('UPLOAD_COMPLETE'), uploadId: z.string().uuid() }),
  base.extend({ type: z.literal('DOWNLOAD_INIT'), fileId: z.string().uuid(), chunkSize: z.number().int().min(MIN_CHUNK).max(MAX_CHUNK).default(DEFAULT_CHUNK), offset: z.number().int().min(0).default(0) }),
  base.extend({ type: z.literal('PING'), timestamp: z.number() })
]);

export const chunkHeader = base.extend({
  type: z.literal('UPLOAD_CHUNK'),
  uploadId: z.string().uuid(),
  index: z.number().int().min(0),
  offset: z.number().int().min(0),
  size: z.number().int().min(0).max(MAX_CHUNK),
  sha256
});

export type ControlMessage = z.infer<typeof controlMessage>;
export type ChunkHeader = z.infer<typeof chunkHeader>;

export function encodeBinary(header: object, payload: Buffer): Buffer {
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  if (head.length > 16 * 1024) throw new Error('协议头过大');
  const output = Buffer.allocUnsafe(4 + head.length + payload.length);
  output.writeUInt32BE(head.length, 0);
  head.copy(output, 4);
  payload.copy(output, 4 + head.length);
  return output;
}

export function decodeBinary(input: Buffer): { header: ChunkHeader; payload: Buffer } {
  if (input.length < 5) throw new Error('二进制帧过短');
  const headerLength = input.readUInt32BE(0);
  if (headerLength < 2 || headerLength > 16 * 1024 || 4 + headerLength > input.length) throw new Error('协议头长度无效');
  const raw = JSON.parse(input.subarray(4, 4 + headerLength).toString('utf8')) as unknown;
  const header = chunkHeader.parse(raw);
  const payload = input.subarray(4 + headerLength);
  if (payload.length !== header.size) throw new Error('载荷长度与协议头不一致');
  return { header, payload };
}

