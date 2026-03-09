import vscode from 'vscode';

import { ContextKey } from './consts.js';

export namespace vsc {
  export const setContext = (key: ContextKey, value: any) =>
    vscode.commands.executeCommand('setContext', 'secretNotes.' + key, value);

  export const showError = (message: string) => vscode.window.showErrorMessage(message);

  export const showInfo = (message: string) => vscode.window.showInformationMessage(message);

  export const setStatusBar = (message: string) => vscode.window.setStatusBarMessage(message, 3200);
}
