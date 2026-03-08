import vscode from 'vscode';
import { EncrytConfig } from '../core/consts.js';
import { vsc } from '../core/methods.js';
import { t } from '../i18n/index.js';
import { CrypNote } from '../lib/crypto.js';

const getVirtualDisplayPath = (sourceUri: vscode.Uri): string => {
  const sourcePath = sourceUri.path;
  const lastSlash = sourcePath.lastIndexOf('/');
  const directoryPath = lastSlash >= 0 ? sourcePath.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath;

  if (filename.length === 0) {
    return sourcePath;
  }

  return `${directoryPath}${t('virtual.displayPrefixDecrypted')}${filename}`;
};

class NoteState {
  sourceUri: vscode.Uri;

  virtualUri: vscode.Uri;

  password: string | null = null;

  decryptedInSession: boolean = false;

  skippedAutoDecrypt: boolean = false;

  /**
   * Avoid decrypting again
   */
  locked: boolean = false;

  encrypted: boolean = false;

  constructor(sourceUri: vscode.Uri) {
    this.sourceUri = sourceUri;
    this.virtualUri = sourceUri.with({
      scheme: EncrytConfig.UriScheme,
      path: getVirtualDisplayPath(sourceUri),
      query: encodeURIComponent(sourceUri.toString()),
      fragment: '',
    });
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
export namespace Note {
  const states = new Map<string, NoteState>();

  export const add = (sourceUri: vscode.Uri): NoteState => {
    const o = new NoteState(sourceUri);
    states.set(sourceUri.toString(), o);
    states.set(o.virtualUri.toString(), o);
    return o;
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
  /**
   * Aim to refresh the state of the source file, not the virtual one.
   */
  // refactor 我觉得只要在save和open新文件的时候用一下此函数就可以了
  export const refresh = async (document: vscode.TextDocument) => {
    if (isVirtualUri(document.uri)) {
      return;
    }

    const state = states.get(document.uri.toString()) ?? add(document.uri);

    try {
      const raw = await vscode.workspace.fs.readFile(state.sourceUri);
      const content = Buffer.from(raw).toString('utf8');
      state.encrypted = CrypNote.isEncrypted(content);
    } catch {
      if (document.uri.scheme === 'file') {
        state.encrypted = CrypNote.isEncrypted(document.getText());
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

  export const isVirtualUri = (uri: vscode.Uri): boolean => uri.scheme === EncrytConfig.UriScheme;
}
