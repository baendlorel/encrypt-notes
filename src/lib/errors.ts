import vscode from 'vscode';
import { t } from '../i18n/index.js';

export namespace NoteError {
  export class InvalidEncryptedFileError extends Error {
    public constructor(message: string) {
      super(message);
      this.name = 'InvalidEncryptedFileError';
    }

    display() {
      vscode.window.showErrorMessage(t('error.decrypt.invalidFile', this.message));
    }
  }

  export class InvalidPasswordError extends Error {
    public constructor(message = 'Invalid password.') {
      super(message);
      this.name = 'InvalidPasswordError';
    }

    display() {
      vscode.window.showErrorMessage(t('error.decrypt.invalidPassword'));
    }
  }

  export const display = (error: InvalidPasswordError | InvalidEncryptedFileError | any): void => {
    if ('display' in error) {
      error.display();
    } else {
      vscode.window.showErrorMessage(t('error.decrypt.failed'));
    }
  };
}
