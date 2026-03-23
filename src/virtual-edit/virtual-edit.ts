import vscode from 'vscode';
import { Consts } from '../core/consts.js';
import { t } from '../i18n/index.js';
import { CrypNote } from '../lib/crypto.js';

import { Note } from './state.js';

const hasUtf8Bom = (content: Uint8Array): boolean =>
  content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;

const getSourceUri = (uri: vscode.Uri): vscode.Uri => Note.getOrAdd(uri).sourceUri;

export class SecretNotesProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  // & Part of the `vscode.FileSystemProvider` interface
  public readonly onDidChangeFile = this.changeEmitter.event;

  public watch(
    _uri: vscode.Uri,
    _options: { readonly recursive: boolean; readonly excludes: readonly string[] },
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const sourceUri = getSourceUri(uri);
    return vscode.workspace.fs.stat(sourceUri);
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const sourceUri = getSourceUri(uri);
    return vscode.workspace.fs.readDirectory(sourceUri);
  }

  public async createDirectory(uri: vscode.Uri): Promise<void> {
    const sourceUri = getSourceUri(uri);
    await vscode.workspace.fs.createDirectory(sourceUri);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const state = Note.getOrAdd(uri);
    const raw = await vscode.workspace.fs.readFile(state.sourceUri);
    const content = Buffer.from(raw).toString('utf8');

    if (!CrypNote.isEncryptedText(content)) {
      return raw;
    }

    if (!state.password) {
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.readMissingPassword'));
    }

    try {
      const plainText = CrypNote.decrypt(content, state.password);
      return Buffer.from(plainText, 'utf8');
    } catch {
      state.password = undefined;
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.readInvalidPassword'));
    }
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    // Saving the decrypted virtual document enters here instead of writing plaintext to disk directly.
    const state = Note.getOrAdd(uri);

    if (!state.password) {
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.writeMissingPassword'));
    }

    let sourceExists = true;
    try {
      await vscode.workspace.fs.stat(state.sourceUri);
    } catch {
      sourceExists = false;
    }

    if (!sourceExists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(state.sourceUri);
    }

    if (sourceExists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(state.sourceUri);
    }

    // Convert the editor plaintext back to encrypted text with the cached password.
    const plainText = Buffer.from(content).toString('utf8');
    const encryptedContent = CrypNote.encrypt(plainText, state.password);
    const encryptedRaw = Buffer.from(encryptedContent, 'utf8');
    let nextRaw = encryptedRaw;

    if (sourceExists) {
      try {
        const sourceRaw = await vscode.workspace.fs.readFile(state.sourceUri);
        if (hasUtf8Bom(sourceRaw)) {
          nextRaw = Buffer.concat([Consts.UTF8_BOM_BUFFER, encryptedRaw]);
        }
      } catch {}
    }

    // Persist the encrypted bytes to the original source file on disk.
    await vscode.workspace.fs.writeFile(state.sourceUri, nextRaw);
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  public async delete(
    uri: vscode.Uri,
    options: { readonly recursive: boolean; readonly useTrash: boolean },
  ): Promise<void> {
    const sourceUri = getSourceUri(uri);
    await vscode.workspace.fs.delete(sourceUri, options);
  }

  public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): Promise<void> {
    const oldSourceUri = getSourceUri(oldUri);
    const newSourceUri = getSourceUri(newUri);
    await vscode.workspace.fs.rename(oldSourceUri, newSourceUri, options);
  }
}
