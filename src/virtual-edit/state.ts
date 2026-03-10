import vscode from 'vscode';
import { EncrytConfig } from '../core/consts.js';
import { configs } from '../core/config.js';
import { vsc } from '../core/methods.js';
import { t } from '../i18n/index.js';
import { CrypNote } from '../lib/crypto.js';

/**
 * Both sourceUri and virtualUri can get the same `NoteState` object.
 */
export namespace Note {
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

  export class State {
    public sourceUri: vscode.Uri;

    public virtualUri: vscode.Uri;

    public decryptedInSession: boolean = false;

    public skippedAutoDecrypt: boolean = false;

    /**
     * Avoid decrypting again
     * - original name is `decryptPromptInProgress`
     */
    public locked: boolean = false;

    public encrypted: boolean = false;

    private _timer: NodeJS.Timeout | undefined = undefined;
    private _password: string | undefined = undefined;

    constructor(sourceUri: vscode.Uri) {
      if (sourceUri.scheme === EncrytConfig.UriScheme) {
        sourceUri = vscode.Uri.parse(decodeURIComponent(sourceUri.query));
      }

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
  export const add = (uri: vscode.Uri): State => {
    const sourceUri = uri.scheme === EncrytConfig.UriScheme ? vscode.Uri.parse(decodeURIComponent(uri.query)) : uri;
    const sourceKey = sourceUri.toString();
    const existing = states.get(uri.toString()) ?? states.get(sourceKey);
    if (existing) {
      states.set(sourceKey, existing);
      states.set(existing.virtualUri.toString(), existing);
      if (uri.toString() !== sourceKey && uri.toString() !== existing.virtualUri.toString()) {
        states.set(uri.toString(), existing);
      }
      return existing;
    }

    const state = new State(sourceUri);
    states.set(sourceKey, state);
    states.set(state.virtualUri.toString(), state);
    if (uri.toString() !== sourceKey && uri.toString() !== state.virtualUri.toString()) {
      states.set(uri.toString(), state);
    }
    return state;
  };

  export const remove = (uri: vscode.Uri): boolean => {
    const state = states.get(uri.toString());
    if (!state) {
      return false;
    }

    const keys = [...states.entries()].flatMap(([key, value]) => (value === state ? [key] : []));
    if (vscode.workspace.textDocuments.some((document) => keys.includes(document.uri.toString()))) {
      return false;
    }

    keys.forEach((key) => states.delete(key));
    return true;
  };

  export const modify = (uri: vscode.Uri, state: Partial<State>) => {
    const o = states.get(uri.toString());
    if (o) {
      Object.assign(o, state);
      return;
    }
    vsc.showError(`NoteState not found for ${uri.toString()}`);
  };

  export const get = (uri: vscode.Uri): State | undefined => states.get(uri.toString());

  /**
   * Use this for strictly getting the state.
   */
  export const getOrFail = (uri: vscode.Uri, fnName: string = ''): State => {
    const state = states.get(uri.toString());
    if (state) {
      return state;
    } else {
      vsc.showError(`(${fnName}) NoteState not found for ${uri.toString()}`);
      throw new Error(`(${fnName}) NoteState not found for ${uri.toString()}`);
    }
  };

  export const getOrAdd = (uri: vscode.Uri): State => states.get(uri.toString()) ?? add(uri);

  // # services

  /**
   * Aim to refresh the state of the source file, not the virtual one.
   */
  export const refresh = async (document: vscode.TextDocument): Promise<State> => {
    const state = getOrAdd(document.uri);

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
  export const isVirtualInput = (input: unknown): input is vscode.TabInputText =>
    input instanceof vscode.TabInputText && isVirtualUri(input.uri);

  export const isActive = (document: vscode.TextDocument) => {
    return vscode.window.activeTextEditor?.document?.uri.toString() === document.uri.toString();
  };
}
