import vscode from 'vscode';
import { AesConfig } from '../core/consts.js';
import { vsc } from '../core/methods.js';
import { ve } from './methods.js';

class NoteState {
  sourceUri: vscode.Uri;

  virtualUri: vscode.Uri;

  password: string | null = null;

  decryptedInSession: boolean = false;

  skippedAutoDecrypt: boolean = false;

  decryptPromptInProgress: boolean = false;

  encrypted: boolean = false;

  constructor(sourceUri: vscode.Uri) {
    this.sourceUri = sourceUri;
    this.virtualUri = ve.toVirtualUri(sourceUri);
  }

  clear() {
    this.password = null;
    this.decryptedInSession = false;
    this.skippedAutoDecrypt = false;
    this.decryptPromptInProgress = false;
    this.encrypted = false;
  }
}

/**
 * Both sourceUri and virtualUri can get the same `NoteState` object.
 */
export namespace notes {
  const states = new Map<string, NoteState>();

  export const add = (sourceUri: vscode.Uri) => {
    const o = new NoteState(sourceUri);
    states.set(sourceUri.toString(), o);
    states.set(o.virtualUri.toString(), o);
  };

  export const remove = (uri: vscode.Uri) => {
    const state = states.get(uri.toString());
    if (state) {
      states.delete(state.sourceUri.toString());
      states.delete(state.virtualUri.toString());
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
  const isEncrypted = (content: string) =>
    content.startsWith(AesConfig.EncryptedFileFlag) || content.startsWith(AesConfig.EncryptedFileFlagWithBom);

  export const refresh = async (document: vscode.TextDocument) => {
    const state = states.get(document.uri.toString());
    if (!state) {
      return;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(state.sourceUri);
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

  export const isVirtualUri = (uri: vscode.Uri): boolean =>
    states.get(uri.toString())?.virtualUri.toString() === uri.toString();
}
