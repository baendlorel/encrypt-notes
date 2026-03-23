import vscode from 'vscode';
import { vsc } from '../core/methods.js';
import { t } from '../i18n/index.js';
import { configs } from '../core/config.js';
import { Note } from '../virtual-edit/state.js';
import { CrypNote } from './crypto.js';

export const promptPassword = async (prompt: string): Promise<string | undefined> => {
  const password = await vscode.window.showInputBox({
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.length === 0 ? t('prompt.passwordRequired') : undefined),
  });
  return password ? password : undefined;
};

/**
 * Confirms a password.
 * - Emit an error message if mismatch, and return false.
 * - Return true if confirmed.
 */
export const confirmPassword = async (password: string): Promise<boolean> => {
  const confirmed = await promptPassword(t('prompt.confirmEncryptPassword'));
  if (confirmed === undefined) {
    return false; // muted return
  }
  if (confirmed === password) {
    return true;
  } else {
    vsc.showError(t('error.encrypt.passwordMismatch'));
    return false;
  }
};

/**
 * Whether it satisfies the condition to be tracked.
 */
export const shouldTrack = (doc?: vscode.TextDocument): doc is vscode.TextDocument =>
  !!doc && (Note.isVirtual(doc) || configs.supports(doc));

export const updateContextAsync = async (): Promise<void> => {
  const doc = vscode.window.activeTextEditor?.document;
  if (shouldTrack(doc)) {
    const isEncrypted = CrypNote.isEncrypted(doc);
    const isVirtual = Note.isVirtual(doc);
    await vsc.setContext('canEncrypt', !isEncrypted && !isVirtual);
    await vsc.setContext('canDecrypt', isEncrypted || isVirtual);
  } else {
    await vsc.setContext('canEncrypt', false);
    await vsc.setContext('canDecrypt', false);
  }
};
