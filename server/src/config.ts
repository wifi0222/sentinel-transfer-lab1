import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8443),
  PUBLIC_ORIGIN: z.string().url().default('https://localhost:8443'),
  JWT_SECRET: z.string().min(32).optional(),
  JWT_SECRET_FILE: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  TLS_ENABLED: bool.default(true),
  TLS_CERT_PATH: z.string().default('./certs/server.crt'),
  TLS_KEY_PATH: z.string().default('./certs/server.key'),
  MTLS_ENABLED: bool.default(false),
  TLS_CA_PATH: z.string().default('./certs/ca.crt'),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(512 * 1024 * 1024),
  DEFAULT_STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  MIN_FREE_DISK_BYTES: z.coerce.number().int().min(0).default(512 * 1024 * 1024),
  MAX_ACTIVE_UPLOADS_PER_USER: z.coerce.number().int().min(1).max(100).default(5),
  MAX_WS_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(5),
  UPLOAD_BYTES_PER_SECOND: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  DOWNLOAD_BYTES_PER_SECOND: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  TRUST_PROXY: bool.default(false),
  REGISTRATION_ENABLED: bool.default(true),
  REGISTRATION_INVITE_CODE: z.string().min(8).max(128).optional()
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: Record<string, string | undefined> = process.env) {
  const parsed = schema.parse(overrides);
  let jwtSecret = parsed.JWT_SECRET;
  if (!jwtSecret && parsed.JWT_SECRET_FILE) {
    jwtSecret = fs.readFileSync(parsed.JWT_SECRET_FILE, 'utf8').trim();
  }
  if (!jwtSecret) {
    if (parsed.NODE_ENV === 'production') throw new Error('JWT_SECRET or JWT_SECRET_FILE is required');
    jwtSecret = 'development-only-secret-change-me-32-bytes';
  }
  if (jwtSecret.length < 32) throw new Error('JWT secret must contain at least 32 characters');

  const dataDir = path.resolve(parsed.DATA_DIR);
  return { ...parsed, jwtSecret, dataDir };
}

