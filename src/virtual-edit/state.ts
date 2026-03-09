import vscode from 'vscode';
import { EncrytConfig } from '../core/consts.js';
import { t } from '../i18n/index.js';

import { vsc } from '../core/methods.js';
import { CrypNote } from '../lib/crypto.js';
import { configs } from 'src/core/config.js';

/**
 * Both sourceUri and virtualUri can get the same `NoteState` object.
 */
export namespace Note {
  export class State {
    sourceUri: vscode.Uri;

    virtualUri: vscode.Uri;

    decryptedInSession: boolean = false;

    skippedAutoDecrypt: boolean = false;

    /**
     * Avoid decrypting again
     * - original name is `decryptPromptInProgress`
     */
    locked: boolean = false;

    encrypted: boolean = false;

    private _timer: NodeJS.Timeout | undefined = undefined;
    private _password: string | undefined = undefined;

    constructor(sourceUri: vscode.Uri) {
      this.sourceUri = sourceUri;
      this.virtualUri = sourceUri.with({
        scheme: EncrytConfig.UriScheme,
        path: createVirtualPath(sourceUri),
        query: encodeURIComponent(sourceUri.toString()),
        fragment: '',
      });
    }

    set password(password: string | undefined) {
      this._password = password;

      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = undefined;
      }

      if (password) {
        this._timer = setTimeout(() => (this.password = undefined), configs.passwordKeepTime);
      }
    }

    get password() {
      return this._password;
    }

    /**
     * When not encrypted, locked or skippedAutoDecrypt
     */
    get cannotDecrypt() {
      return !this.encrypted || this.locked || this.skippedAutoDecrypt;
    }

    get isSourceActive() {
      return vscode.window.activeTextEditor?.document?.uri.toString() === this.sourceUri.toString();
    }

    clear() {
      this.password = undefined;
      this.decryptedInSession = false;
      this.skippedAutoDecrypt = false;
      this.locked = false;
      this.encrypted = false;
    }
  }

  const states = new Map<string, State>();

  const createVirtualPath = (sourceUri: vscode.Uri): string => {
    const sourcePath = sourceUri.path;
    const lastSlash = sourcePath.lastIndexOf('/');
    const directoryPath = lastSlash >= 0 ? sourcePath.slice(0, lastSlash + 1) : '';
    const filename = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath;

    if (filename.length === 0) {
      return sourcePath;
    }

    return `${directoryPath}${t('virtual.displayPrefixDecrypted')}${filename}`;
  };

  export const add = (sourceUri: vscode.Uri): State => {
    const o = new State(sourceUri);
    states.set(sourceUri.toString(), o);
    states.set(o.virtualUri.toString(), o);
    return o;
  };

  export const remove = (uri: vscode.Uri) => {
    const state = states.get(uri.toString());
    if (!state) {
      return;
    }

    const sourceKey = state.sourceUri.toString();
    const virtualKey = state.virtualUri.toString();
    if (
      vscode.workspace.textDocuments.some((document) => {
        const key = document.uri.toString();
        return key === sourceKey || key === virtualKey;
      })
    ) {
      return;
    }

    states.delete(sourceKey);
    states.delete(virtualKey);
  };

  export const modify = (uri: vscode.Uri, state: Partial<State>) => {
    const o = states.get(uri.toString());
    if (o) {
      Object.assign(o, state);
      return;
    }
    vsc.showError(`NoteState not found for ${uri.toString()}`);
  };

  /**
   * ! If **not exist**, create one.
   */
  // refactor 这里拆分为一定获取和不一定获取
  export const get = (uri: vscode.Uri): State => states.get(uri.toString()) ?? add(uri);

  // # services
  export const clearAllPasswords = () => {
    states.forEach((s) => (s.password = undefined));
  };

  /**
   * Aim to refresh the state of the source file, not the virtual one.
   */
  export const refresh = async (document: vscode.TextDocument): Promise<State> => {
    const state = states.get(document.uri.toString()) ?? add(document.uri);

    if (isVirtualUri(document.uri)) {
      return state;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(state.sourceUri);
      const content = Buffer.from(raw).toString('utf8');
      state.encrypted = CrypNote.isEncryptedText(content);
      return state;
    } catch {
      if (document.uri.scheme === 'file') {
        state.encrypted = CrypNote.isEncrypted(document);
      }
      return state;
    }
  };

  export const closeRelatedTabs = async (uri: vscode.Uri) => {
    const target = uri.toString();
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target);

    if (tabs.length === 0) {
      return;
    }

    await vscode.window.tabGroups.close(tabs, true);
  };

  export const isVirtual = (document: vscode.TextDocument) => isVirtualUri(document.uri);
  export const isVirtualUri = (uri: vscode.Uri) => uri.scheme === EncrytConfig.UriScheme;

  export const isActive = (document: vscode.TextDocument) => {
    return vscode.window.activeTextEditor?.document?.uri.toString() === document.uri.toString();
  };
}
