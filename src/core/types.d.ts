export type DecryptTextFn = (content: string, password: string) => string;
export type EncryptTextFn = (plainText: string, password: string) => string;
export type IsEncryptedTextFn = (content: string) => boolean;
