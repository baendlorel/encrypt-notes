import vscode from 'vscode';
import { t } from '../i18n/index.js';
import { Note } from '../virtual-edit/state.js';

import { Commands } from './consts.js';
import { configs } from './config.js';

export class EncryptionCodeLensProvider implements vscode.CodeLensProvider {
  static readonly emitter = new vscode.EventEmitter<void>();

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!configs.buttonOnFirstLine) {
      return [];
    }

    const state = Note.get(document.uri);
    if (!configs.supports(state.sourceUri)) {
      return [];
    }

    const isSourceFile = document.uri.scheme === 'file';
    const canEncrypt = isSourceFile && !state.encrypted;
    const canDecrypt = (isSourceFile && state.encrypted) || Note.isVirtual(document);

    if (!canEncrypt && !canDecrypt) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];

    if (canEncrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: t('codelens.encrypt'),
          command: Commands.Encrypt,
          arguments: [document.uri],
        }),
      );
    }

    if (canDecrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: t('codelens.decrypt'),
          command: Commands.Decrypt,
          arguments: [document.uri],
        }),
      );
    }

    return lenses;
  }
}
