export interface EncryptedHeader {
  readonly v: number;
  readonly alg: string;
  readonly kdf: string;
  readonly iter: number;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
}

export interface ParsedEncryptedFile {
  readonly header: EncryptedHeader;
  readonly ciphertext: Buffer;
}

export type ButtonLocationRaw = 'Fisrt Line' | 'Editor Title' | '首行' | '编辑器右上角';
