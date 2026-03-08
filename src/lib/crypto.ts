import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

import type { EncryptedHeader, ParsedEncryptedFile } from './types.js';
import { EncrytConfig, Consts } from '../core/consts.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './errors.js';

const deriveKey = (password: string, salt: Buffer, iterations: number): Buffer => {
  return pbkdf2Sync(password, salt, iterations, EncrytConfig.KeyLength, EncrytConfig.Pbkdf2Digest);
};

const stripUtf8Bom = (line: string): string => (line.startsWith(Consts.UTF8_BOM) ? line.slice(1) : line);

const findEncryptedFlagLineIndex = (lines: readonly string[]): number => {
  const maxLineCount = Math.min(2, lines.length);

  for (let i = 0; i < maxLineCount; i++) {
    const normalizedLine = stripUtf8Bom(lines[i] ?? '').trim();
    if (normalizedLine.startsWith(EncrytConfig.EncryptedFileFlag)) {
      return i;
    }
  }

  return -1;
};

const parseHeader = (rawHeader: string): EncryptedHeader => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawHeader);
  } catch {
    throw new InvalidEncryptedFileError('Encrypted header is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new InvalidEncryptedFileError('Encrypted header must be an object.');
  }

  const header = parsed as Partial<EncryptedHeader>;

  if (header.v !== 1) {
    throw new InvalidEncryptedFileError('Unsupported encrypted file version.');
  }

  if (header.alg !== 'AES-256-GCM') {
    throw new InvalidEncryptedFileError('Unsupported encryption algorithm.');
  }

  if (header.kdf !== 'PBKDF2-SHA256') {
    throw new InvalidEncryptedFileError('Unsupported key derivation function.');
  }

  if (!Number.isInteger(header.iter) || (header.iter ?? 0) <= 0) {
    throw new InvalidEncryptedFileError('Invalid PBKDF2 iteration count.');
  }

  if (typeof header.salt !== 'string' || typeof header.iv !== 'string' || typeof header.tag !== 'string') {
    throw new InvalidEncryptedFileError('Encrypted header is missing required fields.');
  }

  return {
    v: header.v as number,
    alg: header.alg as string,
    kdf: header.kdf as string,
    iter: header.iter as number,
    salt: header.salt as string,
    iv: header.iv as string,
    tag: header.tag as string,
  };
};

/**
 * First 2 lines may contain ENCRYPTED_FILE_FLAG.
 * Detection is strict: strip UTF-8 BOM, trim, then startsWith flag.
 */
export const isEncryptedText = (content: string): boolean => findEncryptedFlagLineIndex(content.split(/\r?\n/)) !== -1;

const parseEncryptedText = (content: string): ParsedEncryptedFile => {
  const lines = content.split(/\r?\n/);
  const markerLineIndex = findEncryptedFlagLineIndex(lines);
  if (markerLineIndex < 0) {
    throw new InvalidEncryptedFileError('Missing encrypted file marker.');
  }

  const headerLineIndex = markerLineIndex + 1;
  const payloadStartLineIndex = markerLineIndex + 2;
  if (lines.length <= payloadStartLineIndex) {
    throw new InvalidEncryptedFileError('Encrypted file is incomplete.');
  }

  const header = parseHeader(stripUtf8Bom(lines[headerLineIndex] ?? ''));
  const cipherTextPayload = lines.slice(payloadStartLineIndex).join('').trim();

  if (cipherTextPayload.length === 0) {
    throw new InvalidEncryptedFileError('Encrypted payload is empty.');
  }

  const ciphertext = Buffer.from(cipherTextPayload, 'base64');
  if (ciphertext.length === 0) {
    throw new InvalidEncryptedFileError('Encrypted payload is invalid base64.');
  }

  return { header, ciphertext };
};

export const encryptText = (plainText: string, password: string): string => {
  const salt = randomBytes(EncrytConfig.SaltLength);
  const iv = randomBytes(EncrytConfig.IvLength);
  const key = deriveKey(password, salt, EncrytConfig.Pbkdf2Iterations);

  const cipher = createCipheriv(EncrytConfig.Algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header: EncryptedHeader = {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: EncrytConfig.Pbkdf2Iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };

  return [EncrytConfig.EncryptedFileFlag, JSON.stringify(header), ciphertext.toString('base64')].join('\n');
};

export const decryptText = (content: string, password: string): string => {
  const { header, ciphertext } = parseEncryptedText(content);

  const salt = Buffer.from(header.salt, 'base64');
  const iv = Buffer.from(header.iv, 'base64');
  const tag = Buffer.from(header.tag, 'base64');

  if (salt.length !== EncrytConfig.SaltLength || iv.length !== EncrytConfig.IvLength || tag.length !== 16) {
    throw new InvalidEncryptedFileError('Encrypted metadata has invalid lengths.');
  }

  const key = deriveKey(password, salt, header.iter);

  try {
    const decipher = createDecipheriv(EncrytConfig.Algorithm, key, iv);
    decipher.setAuthTag(tag);
    const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plainText.toString('utf8');
  } catch {
    throw new InvalidPasswordError('Password is incorrect or file is corrupted.');
  }
};
