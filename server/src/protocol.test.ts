import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { decodeBinary, encodeBinary } from './protocol.js';

describe('SFT protocol codec', () => {
  it('round-trips validated upload chunks', () => {
    const payload = Buffer.from('secure payload');
    const header = { v: 1, type: 'UPLOAD_CHUNK', requestId: 'request-1234', uploadId: crypto.randomUUID(), index: 0, offset: 0, size: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex') };
    const decoded = decodeBinary(encodeBinary(header, payload));
    expect(decoded.header).toEqual(header);
    expect(decoded.payload).toEqual(payload);
  });
  it('rejects mismatched payload lengths', () => {
    const payload = Buffer.from('x');
    const header = { v: 1, type: 'UPLOAD_CHUNK', requestId: 'request-1234', uploadId: crypto.randomUUID(), index: 0, offset: 0, size: 2, sha256: 'a'.repeat(64) };
    expect(() => decodeBinary(encodeBinary(header, payload))).toThrow('载荷长度');
  });
});

