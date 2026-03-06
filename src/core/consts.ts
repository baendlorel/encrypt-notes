import { ButtonLocationRaw } from '../lib/types.js';

export namespace AesConfig {
  export const Algorithm = 'aes-256-gcm';
  export const KeyLength = 32;
  export const IvLength = 12;
  export const SaltLength = 16;
  export const Pbkdf2Digest = 'sha256';
  export const Pbkdf2Iterations = 210000;
  export const EncryptedFileFlag = 'ENCRYPTED_FILE';
}

export namespace Consts {
  export const ExtensionId = 'encrypted-notes';

  /**
   * Virtual document scheme used for decrypted content.
   */
  export const UTF8_BOM = '\uFEFF';
  export const UTF8_BOM_BUFFER = Buffer.from([0xef, 0xbb, 0xbf]);
}

export const enum ContextKey {
  SupportedDocument = 'encryptedNotes.supportedDocument',
  IsEncryptedDocument = 'encryptedNotes.isEncryptedDocument',
  CanEncryptDocument = 'encryptedNotes.canEncryptDocument',
  CanDecryptDocument = 'encryptedNotes.canDecryptDocument',
  CanPermanentDecrypt = 'encryptedNotes.canPermanentDecrypt',
  ShowCodeLensActions = 'encryptedNotes.showCodeLensActions',
  ShowTitleActions = 'encryptedNotes.showTitleActions',
}

export namespace Configs {
  export const DefaultFileExtensions = ['.txt', '.md'];
  export const DefaultButtonLocation: ButtonLocation = ButtonLocation.FirstLine;
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
  export const Encrypt = 'encrypted-notes.encrypt';
  export const Decrypt = 'encrypted-notes.decrypt';
}
