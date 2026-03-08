import vscode from 'vscode';
import { vsc } from '../core/methods.js';
import { ve } from './methods.js';

class NoteState {
  sourceUri: vscode.Uri;

  virtualUri: vscode.Uri;

  password: string | null = null;

  decryptedInSession: boolean = false;

  skippedAutoDecrypt: boolean = false;

  decryptPromptInProgress: boolean = false;

  encryptedOnDisk: boolean = false;

  constructor(sourceUri: vscode.Uri) {
    this.sourceUri = sourceUri;
    this.virtualUri = ve.toVirtualUri(sourceUri);
  }

  clear() {
    this.password = null;
    this.decryptedInSession = false;
    this.skippedAutoDecrypt = false;
    this.decryptPromptInProgress = false;
    this.encryptedOnDisk = false;
  }
}

/**
 * Both sourceUri and virtualUri can get the same `NoteState` object.
 */
export namespace notes {
  const states = new WeakMap<vscode.Uri, NoteState>();
  export const add = (sourceUri: vscode.Uri) => {
    const o = new NoteState(sourceUri);
    states.set(sourceUri, o);
    states.set(o.virtualUri, o);
  };

  export const remove = (uri: vscode.Uri) => {
    const state = states.get(uri);
    if (state) {
      states.delete(state.sourceUri);
      states.delete(state.virtualUri);
    }
  };

  export const modify = (uri: vscode.Uri, state: Partial<NoteState>) => {
    const o = states.get(uri);
    if (o) {
      Object.assign(o, state);
    }
    vsc.showError(`NoteState not found for ${uri.toString()}`);
  };

  export const get = (uri: vscode.Uri): NoteState | undefined => {
    return states.get(uri);
  };

  export const isVirtualUri = (uri: vscode.Uri): boolean => states.get(uri)?.virtualUri.toString() === uri.toString();
}
