import vscode from 'vscode';
import { EncrytConfig } from '../core/consts.js';
import { vsc } from '../core/methods.js';
import { ve } from './methods.js';

class NoteState {
  sourceUriStr: string;

  virtualUriStr: string;

  password: string | null = null;

  decryptedInSession: boolean = false;

  skippedAutoDecrypt: boolean = false;

  /**
   * Avoid decrypting again
   */
  locked: boolean = false;

  encrypted: boolean = false;

  constructor(sourceUri: vscode.Uri) {
    this.sourceUriStr = sourceUri.toString();
    this.virtualUriStr = ve.toVirtualUri(sourceUri).toString();
  }

  clear() {
    this.password = null;
    this.decryptedInSession = false;
    this.skippedAutoDecrypt = false;
    this.locked = false;
    this.encrypted = false;
  }
}

/**
 * Both sourceUri and virtualUri can get the same `NoteState` object.
 */
export namespace notes {
  const states = new Map<string, NoteState>();

  export const add = (sourceUri: vscode.Uri): NoteState => {
    const o = new NoteState(sourceUri);
    states.set(sourceUri.toString(), o);
    states.set(o.virtualUriStr.toString(), o);
    return o;
  };

  export const remove = (uri: vscode.Uri) => {
    const state = states.get(uri.toString());
    if (state) {
      states.delete(state.sourceUriStr.toString());
      states.delete(state.virtualUriStr.toString());
    }
  };

  export const modify = (uri: vscode.Uri, state: Partial<NoteState>) => {
    const o = states.get(uri.toString());
    if (o) {
      Object.assign(o, state);
    }
    vsc.showError(`NoteState not found for ${uri.toString()}`);
  };

  export const get = (uri: vscode.Uri): NoteState | undefined => states.get(uri.toString());

  // # services
  /**
   * Aim to refresh the state of the source file, not the virtual one.
   */
  // refactor 我觉得只要在save和open新文件的时候用一下此函数就可以了
  export const refresh = async (document: vscode.TextDocument) => {
    // & Only this plugin can open this kind of virtual document.
    // & So it is no need to refresh the state.
    if (isVirtual(document)) {
      return;
    }

    const state = states.get(document.uri.toString()) ?? add(document.uri);

    try {
      const raw = await vscode.workspace.fs.readFile(state.sourceUriStr);
      const content = Buffer.from(raw).toString('utf8');
      state.encrypted = isEncrypted(content);
    } catch {
      if (document.uri.scheme === 'file') {
        state.encrypted = isEncrypted(document.getText());
      }
    }
  };

  export const closeRelatedTabs = async (uri: vscode.Uri) => {
    const state = states.get(uri.toString());
    if (!state) {
      return;
    }

    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText && states.has(tab.input.uri.toString()));

    if (tabs.length === 0) {
      return;
    }

    await vscode.window.tabGroups.close(tabs, true);
    remove(uri);
  };

  const isEncrypted = (s: string) => s.startsWith(EncrytConfig.FileFlag) || s.startsWith(EncrytConfig.FileFlagWithBom);

  export const isVirtual = (document: vscode.TextDocument) => document.uri.scheme === EncrytConfig.UriScheme;

  export const isVirtualUri = (uri: vscode.Uri): boolean =>
    states.get(uri.toString())?.virtualUriStr.toString() === uri.toString();
}
