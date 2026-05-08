export namespace EncryptConfig {
  export const Algorithm = 'aes-256-gcm';
  export const KeyLength = 32;
  export const IvLength = 12;
  export const SaltLength = 16;
  export const Pbkdf2Digest = 'sha256';
  export const Pbkdf2Iterations = 210000;

  // flags
  export const Flag = 'ENCRYPTED_FILE';
  export const FlagWithBom = '\uFEFFENCRYPTED_FILE';
  export const UriScheme = 'secret-notes-decrypted';
}

export namespace Consts {
  export const ExtensionId = 'secret-notes';

  /**
   * Virtual document scheme used for decrypted content.
   */
  export const UTF8_BOM = '\uFEFF';
  export const UTF8_BOM_BUFFER = Buffer.from([0xef, 0xbb, 0xbf]);
}

export type ContextKey = 'canEncrypt' | 'canDecrypt';

export namespace Configs {
  export const DefaultFileExts = ['.txt', '.md'];
  export const DefaultExclude = ['node_modules', 'dist', 'out', 'build', 'coverage', '.git', '.next', '.turbo'];
  export const DefaultPasswordKeepMinute = 5;
}

export namespace Commands {
  export const Encrypt = 'secret-notes.encrypt';
  export const Decrypt = 'secret-notes.decrypt';
}
