import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

import { InvalidEncryptedFileError } from './errors.js';
import {
  KEY_LENGTH,
  PBKDF2_DIGEST,
  ENCRYPTED_FILE_FLAG,
  SALT_LENGTH,
  IV_LENGTH,
  PBKDF2_ITERATIONS,
  AES_ALGORITHM,
} from './consts.js';
import { EncryptedHeader, ParsedEncryptedFile } from './types.js';

const stripBom = (value: string): string => value.replace(/^\uFEFF/, '');

const deriveKey = (password: string, salt: Buffer, iterations: number): Buffer => {
  return pbkdf2Sync(password, salt, iterations, KEY_LENGTH, PBKDF2_DIGEST);
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
 * & First 2 lines may contains the ENCRYPTED_FILE_FLAG
 */
export const isEncryptedText = (content: string): boolean =>
  content
    .split(/\r?\n/, 1)
    .slice(0, 2)
    .some((line) => line.includes(ENCRYPTED_FILE_FLAG));

const parseEncryptedText = (content: string): ParsedEncryptedFile => {
  if (!isEncryptedText(content)) {
    throw new InvalidEncryptedFileError('Missing encrypted file marker.');
  }

  const lines = content.split(/\r?\n/);
  if (lines.length < 3) {
    throw new InvalidEncryptedFileError('Encrypted file is incomplete.');
  }

  const header = parseHeader(lines[1] ?? '');
  const cipherTextPayload = lines.slice(2).join('').trim();

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
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt, PBKDF2_ITERATIONS);

  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header: EncryptedHeader = {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };

  return [ENCRYPTED_FILE_FLAG, JSON.stringify(header), ciphertext.toString('base64')].join('\n');
};

export const decryptText = (content: string, password: string): string => {
  const { header, ciphertext } = parseEncryptedText(content);

  const salt = Buffer.from(header.salt, 'base64');
  const iv = Buffer.from(header.iv, 'base64');
  const tag = Buffer.from(header.tag, 'base64');

  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || tag.length !== 16) {
    throw new InvalidEncryptedFileError('Encrypted metadata has invalid lengths.');
  }

  const key = deriveKey(password, salt, header.iter);

  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plainText.toString('utf8');
  } catch {
    throw new Error('[InvalidPasswordError] Password is incorrect or file is corrupted.');
  }
};
