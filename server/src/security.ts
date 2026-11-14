import crypto from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, keyText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !saltText || !keyText) return false;
  if (Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function safeDisplayName(value: string): string {
  const normalized = value.normalize('NFC');
  if (normalized.length < 1 || normalized.length > 180) throw new Error('文件名长度必须为 1-180 个字符');
  if (/[/\\\u0000-\u001f\u007f]/u.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error('文件名包含不安全字符');
  }
  return normalized;
}

