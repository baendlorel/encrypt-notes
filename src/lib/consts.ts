import { ActionButtonLocation } from './types.js';

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
  export const VDocScheme = 'encrypted-notes-decrypted';
}

export namespace ContextKey {
  export const SupportedDocument = 'encryptedNotes.supportedDocument';
  export const IsEncryptedDocument = 'encryptedNotes.isEncryptedDocument';
  export const CanEncryptDocument = 'encryptedNotes.canEncryptDocument';
  export const CanDecryptDocument = 'encryptedNotes.canDecryptDocument';
  export const CanPermanentDecrypt = 'encryptedNotes.canPermanentDecrypt';
  export const ShowCodeLensActions = 'encryptedNotes.showCodeLensActions';
  export const ShowTitleActions = 'encryptedNotes.showTitleActions';
}

export namespace Defaults {
  export const FileExtensions = ['txt', 'md'];
  export const ActionButtonLocation: ActionButtonLocation = 'Fisrt Line';
  export const isActionButtonLocation = (value: string): value is ActionButtonLocation =>
    ['Fisrt Line', 'Editor Title', '首行', '编辑器右上角'].includes(value);
}

export namespace Commands {
  export const Encrypt = 'encrypted-notes.codelensEncryptCurrent';
  export const Decrypt = 'encrypted-notes.codelensDecryptCurrent';
}

export const CODELENS_ENCRYPT_COMMAND = 'encrypted-notes.codelensEncryptCurrent';
export const CODELENS_DECRYPT_COMMAND = 'encrypted-notes.codelensDecryptCurrent';
