import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, hashFile } from './protocol';

describe('binary application protocol', () => {
  it('round-trips a length-prefixed header and payload', () => {
    const payload = new Uint8Array([0, 1, 2, 255]);
    const decoded = decodeFrame(encodeFrame({ v: 1, type: 'TEST', requestId: 'abcdefgh' }, payload));
    expect(decoded.value.type).toBe('TEST');
    expect([...decoded.payload!]).toEqual([...payload]);
  });
  it('rejects malformed header lengths', () => {
    const bad = new Uint8Array(8); new DataView(bad.buffer).setUint32(0, 1000, false);
    expect(() => decodeFrame(bad.buffer)).toThrow('协议头长度无效');
  });
  it('hashes files incrementally', async () => {
    await expect(hashFile(new Blob(['abc']))).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

