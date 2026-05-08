import crypto from 'node:crypto';
import vscode from 'vscode';
import type { EncryptedHeader, ParsedEncryptedFile } from './types.js';

import { EncryptConfig } from '../core/consts.js';
import { NoteError } from './errors.js';

export namespace CrypNote {
  const deriveKey = (password: string, salt: Buffer, iterations: number): Buffer =>
    crypto.pbkdf2Sync(password, salt, iterations, EncryptConfig.KeyLength, EncryptConfig.Pbkdf2Digest);

  const parseHeader = (rawHeader: string): EncryptedHeader => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawHeader.replace(/^\uFEFF/, ''));
    } catch {
      throw new NoteError.InvalidEncryptedFileError('Encrypted header is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new NoteError.InvalidEncryptedFileError('Encrypted header must be an object.');
    }

    const { v, alg, kdf, iter = 0, salt, iv, tag } = parsed as Partial<EncryptedHeader>;

    if (v !== 1) {
      throw new NoteError.InvalidEncryptedFileError('Unsupported encrypted file version.');
    }

    if (alg !== 'AES-256-GCM') {
      throw new NoteError.InvalidEncryptedFileError('Unsupported encryption algorithm.');
    }

    if (kdf !== 'PBKDF2-SHA256') {
      throw new NoteError.InvalidEncryptedFileError('Unsupported key derivation function.');
    }

    if (!Number.isInteger(iter) || iter <= 0) {
      throw new NoteError.InvalidEncryptedFileError('Invalid PBKDF2 iteration count.');
    }

    if (typeof salt !== 'string' || typeof iv !== 'string' || typeof tag !== 'string') {
      throw new NoteError.InvalidEncryptedFileError('Encrypted header is missing required fields.');
    }

    return { v, alg, kdf, iter, salt, iv, tag };
  };

  /**
   * `Content` has 3 lines
   * 1. File flag
   * 2. JSON stringified header (metadata)
   * 3. Base64 encoded ciphertext
   */
  const parseEncryptedText = (content: string): ParsedEncryptedFile => {
    const lines = content.split(/\r?\n/);

    const headerIndex = 1;
    const payloadIndex = 2;
    if (lines.length <= payloadIndex) {
      throw new NoteError.InvalidEncryptedFileError('Encrypted file is incomplete.');
    }

    const header = parseHeader(lines[headerIndex]);
    const cipherTextBase64 = lines.slice(payloadIndex).join('').trim(); // & more compatible when there is extra newlines in the end of the file
    if (cipherTextBase64.length === 0) {
      throw new NoteError.InvalidEncryptedFileError('Encrypted payload is empty.');
    }

    return { header, ciphertext: Buffer.from(cipherTextBase64, 'base64') };
  };

  export const isEncryptedText = (s: string) =>
    s.startsWith(EncryptConfig.Flag) || s.startsWith(EncryptConfig.FlagWithBom);

  export const isEncrypted = (document: vscode.TextDocument) => isEncryptedText(document.getText());

  export const encrypt = (plainText: string, password: string): string => {
    const salt = crypto.randomBytes(EncryptConfig.SaltLength);
    const iv = crypto.randomBytes(EncryptConfig.IvLength);
    const key = deriveKey(password, salt, EncryptConfig.Pbkdf2Iterations);

    const cipher = crypto.createCipheriv(EncryptConfig.Algorithm, key, iv);
    // ! Must be down before getAuthTag()
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]).toString('base64');

    const tag = cipher.getAuthTag();
    const header: EncryptedHeader = {
      v: 1,
      alg: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iter: EncryptConfig.Pbkdf2Iterations,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };

    return [EncryptConfig.Flag, JSON.stringify(header), ciphertext].join('\n');
  };

  /**
   * ! **Must** ensure the content starts with `FileFlag` or `FileFlagWithBom` before calling this function
   */
  export const decrypt = (content: string, password: string): string => {
    const { header, ciphertext } = parseEncryptedText(content);

    const salt = Buffer.from(header.salt, 'base64');
    const iv = Buffer.from(header.iv, 'base64');
    const tag = Buffer.from(header.tag, 'base64');

    if (salt.length !== EncryptConfig.SaltLength || iv.length !== EncryptConfig.IvLength || tag.length !== 16) {
      throw new NoteError.InvalidEncryptedFileError('Encrypted metadata has invalid lengths.');
    }

    const key = deriveKey(password, salt, header.iter);

    try {
      const decipher = crypto.createDecipheriv(EncryptConfig.Algorithm, key, iv);
      decipher.setAuthTag(tag);
      const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plainText.toString('utf8');
    } catch {
      throw new NoteError.InvalidPasswordError('Password is incorrect or file is corrupted.');
    }
  };
}
