import { ActionButtonLocationRaw } from '../lib/types.js';

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
  export const DefaultFileExtensions = ['txt', 'md'];
  export const DefaultActionButtonLocation: ActionButtonLocation = ActionButtonLocation.FirstLine;
  export const enum ActionButtonLocation {
    FirstLine,
    EditorTitle,
  }

  const actionButtonLocationMap: Record<ActionButtonLocationRaw, ActionButtonLocation> = {
    'Fisrt Line': ActionButtonLocation.FirstLine,
    首行: ActionButtonLocation.FirstLine,
    'Editor Title': ActionButtonLocation.EditorTitle,
    编辑器右上角: ActionButtonLocation.EditorTitle,
  };
  export const justifyActionButtonLocation = (value: string = ''): ActionButtonLocation =>
    actionButtonLocationMap[value as ActionButtonLocationRaw] ?? ActionButtonLocation.FirstLine;
}

export namespace Commands {
  export const Encrypt = 'encrypted-notes.codelensEncryptCurrent';
  export const Decrypt = 'encrypted-notes.codelensDecryptCurrent';
}
