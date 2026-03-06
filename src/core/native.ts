import vscode from 'vscode';
import { ContextKey } from './consts.js';

export namespace vsc {
  export const setContext = (key: ContextKey, value: any) => vscode.commands.executeCommand('setContext', key, value);
}
