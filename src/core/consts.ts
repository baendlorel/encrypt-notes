import { ButtonLocationRaw } from '../lib/types.js';

export namespace EncrytConfig {
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

export type ContextKey = 'canEncrypt' | 'canDecrypt' | 'buttonOnEditorTitle';

export namespace Configs {
  export const DefaultFileExtensions = ['.txt', '.md'];
  export const DefaultExclude = [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/coverage/**',
    '**/.git/**',
    '**/.next/**',
    '**/.turbo/**',
  ];
  export const DefaultButtonLocation: ButtonLocation = ButtonLocation.FirstLine;
  export const DefaultPasswordKeepMinute = 5;
  export const enum ButtonLocation {
    FirstLine,
    EditorTitle,
  }

  const buttonLocationMap: Record<ButtonLocationRaw, ButtonLocation> = {
    'Fisrt Line': ButtonLocation.FirstLine,
    首行: ButtonLocation.FirstLine,
    'Editor Title': ButtonLocation.EditorTitle,
    编辑器右上角: ButtonLocation.EditorTitle,
  };
  export const justifyButtonLocation = (value: string = ''): ButtonLocation =>
    buttonLocationMap[value as ButtonLocationRaw] ?? ButtonLocation.FirstLine;
}

export namespace Commands {
  export const Encrypt = 'secret-notes.encrypt';
  export const Decrypt = 'secret-notes.decrypt';
}
