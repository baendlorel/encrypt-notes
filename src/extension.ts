import * as vscode from 'vscode';

import { Consts, EncrytConfig } from './core/consts.js';
import { configs } from './core/config.js';
import { t } from './i18n/index.js';
import { NoteError } from './lib/errors.js';

import { vsc } from './core/methods.js';
import { Note } from './virtual-edit/state.js';
import { SecretNotesProvider } from './virtual-edit/virtual-edit.js';
import { CrypNote } from './lib/crypto.js';
import { EncryptionCodeLensProvider } from './core/code-lens.provider.js';

const promptPassword = async (prompt: string): Promise<string | undefined> => {
  const password = await vscode.window.showInputBox({
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.length === 0 ? t('prompt.passwordRequired') : undefined),
  });
  return password ? password : undefined;
};

const confirmPassword = async (document: vscode.TextDocument): Promise<string | undefined> => {
  const state = Note.getOrFail(document.uri, 'confirmPassword');

  const password = await promptPassword(t('prompt.confirmDecrypt'));
  if (!password) {
    return undefined;
  }

  if (state.password === password) {
    return password;
  }

  let encryptedContent: string;
  if (Note.isVirtual(document)) {
    try {
      const sourceRaw = await vscode.workspace.fs.readFile(state.sourceUri);
      encryptedContent = Buffer.from(sourceRaw).toString('utf8');
    } catch {
      vsc.showError(t('error.decrypt.failed'));
      return undefined;
    }
  } else {
    encryptedContent = document.getText();
  }

  try {
    CrypNote.decrypt(encryptedContent, password);
    return password;
  } catch (error) {
    NoteError.display(error);
    return undefined;
  }
};

const apply = async (document: vscode.TextDocument, nextContent: string): Promise<boolean> => {
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, range, nextContent);
  return vscode.workspace.applyEdit(edit);
};

const shouldTrackDocument = (document?: vscode.TextDocument): document is vscode.TextDocument =>
  !!document && (Note.isVirtual(document) || configs.supports(document.uri));

const updateContextAsync = async (): Promise<void> => {
  const document = vscode.window.activeTextEditor?.document;

  await vsc.setContext('buttonOnEditorTitle', configs.buttonOnEditorTitle);

  let canEncrypt = false;
  let canDecrypt = false;

  if (shouldTrackDocument(document)) {
    const state = await Note.refresh(document);
    const isSourceFile = document.uri.scheme === 'file';
    canEncrypt = !state.encrypted;
    canDecrypt = (isSourceFile && state.encrypted) || Note.isVirtual(document);
  }

  await vsc.setContext('canEncrypt', canEncrypt);
  await vsc.setContext('canDecrypt', canDecrypt);

  EncryptionCodeLensProvider.emitter.fire();
};

const openVirtualEditor = async (
  sourceDocument: vscode.TextDocument,
  state: Note.State,
  password: string,
  showSuccessMessage: boolean,
): Promise<boolean> => {
  if (state.sourceUri.scheme !== 'file') {
    vsc.showError(t('error.onlyLocalFile'));
    return false;
  }

  try {
    CrypNote.decrypt(sourceDocument.getText(), password);
  } catch (error) {
    NoteError.display(error);
    return false;
  }

  try {
    state.password = password;
    state.decryptedInSession = true;
    state.skippedAutoDecrypt = false;
    state.encrypted = true;

    const targetViewColumn = vscode.window.activeTextEditor?.viewColumn;

    // Open the decrypted virtual document so later saves go through the custom file system provider.
    const virtualDocument = await vscode.workspace.openTextDocument(state.virtualUri);
    await vscode.window.showTextDocument(virtualDocument, { preview: false, viewColumn: targetViewColumn });
    await Note.closeRelatedTabs(state.sourceUri);

    if (showSuccessMessage) {
      vsc.setStatusBar(t('info.decrypt.openVirtualSuccess'));
    }

    return true;
  } catch {
    vsc.showError(t('error.decrypt.openVirtualFailed'));
    return false;
  }
};

const tryDecrypt = async (document: vscode.TextDocument, showSuccessMessage = true): Promise<boolean> => {
  if (!CrypNote.isEncrypted(document)) {
    return false;
  }

  // & Since its encrypted, and it must have a state, otherwise it's weird, just fail.
  const state = Note.getOrFail(document.uri, 'tryDecrypt');

  const cachedPassword = state.password;
  if (cachedPassword) {
    const opened = await openVirtualEditor(document, state, cachedPassword, showSuccessMessage);
    if (opened) {
      return true;
    }
  }

  state.password = undefined;
  const password = await promptPassword(t('prompt.decryptPassword'));
  if (!password) {
    return false;
  }

  return openVirtualEditor(document, state, password, showSuccessMessage);
};

const encrypt = async (document: vscode.TextDocument): Promise<void> => {
  if (Note.isVirtual(document)) {
    const saved = await document.save();
    if (!saved) {
      vsc.showError(t('error.save.retry'));
      return;
    }

    vsc.setStatusBar(t('info.encrypt.savedFromVirtual'));
    return;
  }

  const state = Note.getOrAdd(document.uri);

  if (!configs.supports(state.sourceUri)) {
    vsc.showError(t('error.encrypt.unsupportedExtension'));
    return;
  }

  if (CrypNote.isEncrypted(document)) {
    vsc.setStatusBar(t('info.encrypt.alreadyEncrypted'));
    return;
  }

  let password = state.password;
  if (!password) {
    password = await promptPassword(t('prompt.encryptPassword'));
    if (!password) {
      return;
    }
  }

  const plainText = document.getText();
  const encryptedContent = CrypNote.encrypt(plainText, password);

  const applied = await apply(document, encryptedContent);
  if (!applied) {
    vsc.showError(t('error.encrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    vsc.showError(t('error.encrypt.saveFailed'));
    return;
  }

  state.password = password;
  state.decryptedInSession = true;
  state.encrypted = true;
  state.skippedAutoDecrypt = false;

  const encryptedDocument = await vscode.workspace.openTextDocument(state.sourceUri);
  const opened = await openVirtualEditor(encryptedDocument, state, password, false);
  if (opened) {
    vsc.setStatusBar(t('info.encrypt.savedAndContinueDecrypted'));
  }
};

/**
 * Permanently decrypt
 */
const decrypt = async (document: vscode.TextDocument): Promise<void> => {
  const state = Note.getOrFail(document.uri, 'decrypt');

  if (Note.isVirtual(document)) {
    const plainText = document.getText();

    try {
      await vscode.workspace.fs.writeFile(state.sourceUri, Buffer.from(plainText, 'utf8'));
    } catch {
      vsc.showError(t('error.permanentDecrypt.writePlainFailed'));
      return;
    }

    state.clear();

    const sourceDocument = await vscode.workspace.openTextDocument(state.sourceUri);
    await vscode.window.showTextDocument(sourceDocument, {
      preview: false,
      viewColumn: vscode.window.activeTextEditor?.viewColumn,
    });
    await Note.closeRelatedTabs(document.uri);

    vsc.setStatusBar(t('info.permanentDecrypt.saved'));
    return;
  }

  if (!CrypNote.isEncrypted(document)) {
    vsc.setStatusBar(t('info.decrypt.notNeeded'));
    return;
  }

  const cachedPassword = state?.password;
  const password = cachedPassword ?? (await promptPassword(t('prompt.decryptPassword')));
  if (!password) {
    return;
  }

  let plainText: string;
  try {
    plainText = CrypNote.decrypt(document.getText(), password);
  } catch (error) {
    NoteError.display(error);
    return;
  }

  const applied = await apply(document, plainText);
  if (!applied) {
    vsc.showError(t('error.permanentDecrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    vsc.showError(t('error.permanentDecrypt.saveFailed'));
    return;
  }

  state.clear();
  vsc.setStatusBar(t('info.permanentDecrypt.saved'));
};

const handleActiveDocument = async (mode: 'encrypt' | 'decrypt'): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vsc.showError(t('error.noActiveEditor'));
    return;
  }

  const document = editor.document;
  if (document.uri.scheme !== 'file' && !Note.isVirtual(document)) {
    vsc.showError(t('error.onlyLocalFile'));
    return;
  }

  if (mode === 'encrypt') {
    await encrypt(document);
    await updateContextAsync();
    return;
  }

  if (mode === 'decrypt') {
    if (!Note.isVirtual(document) && !CrypNote.isEncrypted(document)) {
      vsc.setStatusBar(t('info.decrypt.notNeeded'));
      return;
    }

    const password = await confirmPassword(document);
    if (!password) {
      return;
    }

    Note.modify(document.uri, { password });
    await decrypt(document);
    await updateContextAsync();
    return;
  }
};

const tryAutoDecrypt = async (document?: vscode.TextDocument): Promise<void> => {
  if (!document || !configs.supports(document.uri)) {
    return;
  }

  const state = Note.getOrAdd(document.uri);
  state.encrypted = CrypNote.isEncrypted(document);
  if (state.cannotDecrypt) {
    return;
  }

  if (!state.isSourceActive) {
    return;
  }

  state.locked = true;

  try {
    const success = await tryDecrypt(document, false);
    if (!success) {
      state.skippedAutoDecrypt = true;
    }
  } finally {
    state.locked = false;
    await updateContextAsync();
  }
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  // Load configurations
  configs.update();

  context.subscriptions.push(
    EncryptionCodeLensProvider.emitter,
    vscode.workspace.registerFileSystemProvider(EncrytConfig.UriScheme, new SecretNotesProvider(), {
      isCaseSensitive: true,
    }),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: EncrytConfig.UriScheme }],
      new EncryptionCodeLensProvider(),
    ),
    // & This is for menu editor/title to trigger
    vscode.commands.registerCommand('secret-notes.encrypt', () => handleActiveDocument('encrypt')),
    vscode.commands.registerCommand('secret-notes.decrypt', () => handleActiveDocument('decrypt')),

    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (shouldTrackDocument(document)) {
        await Note.refresh(document);
        await tryAutoDecrypt(document);
      }

      await updateContextAsync();
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (shouldTrackDocument(editor?.document)) {
        await Note.refresh(editor.document);
        await tryAutoDecrypt(editor.document);
      }

      await updateContextAsync();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (Note.isActive(event.document)) {
        updateContextAsync();
      }
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (shouldTrackDocument(document)) {
        const state = await Note.refresh(document);

        if (Note.isVirtual(document)) {
          // After the virtual document save completes, refresh UI state to keep the editor in decrypted mode.
          state.encrypted = false;
          state.decryptedInSession = true;
          vscode.window.setStatusBarMessage(t('status.savedEncrypted'), 1600);
        }
      }

      if (Note.isActive(document)) {
        await updateContextAsync();
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      const closedVirtualUris = event.closed
        .map((tab) => tab.input)
        .filter(Note.isVirtualInput)
        .map((tabInput) => tabInput.uri);

      if (closedVirtualUris.length === 0) {
        return;
      }

      const stillOpen = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs.map((tab) => tab.input))
        .filter((input) => input instanceof vscode.TabInputText)
        .map((input) => input.uri.toString());

      for (const uri of closedVirtualUris) {
        if (stillOpen.includes(uri.toString())) {
          continue;
        }

        Note.get(uri)?.clear();
        Note.remove(uri);
      }

      await updateContextAsync();
    }),
    vscode.workspace.onDidCloseTextDocument(async (document) => {
      Note.remove(document.uri);
      await updateContextAsync();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(Consts.ExtensionId)) {
        return;
      }

      configs.update();
      vsc.showInfo(t('info.configurationUpdated'));
      await updateContextAsync();
      await tryAutoDecrypt(vscode.window.activeTextEditor?.document);
    }),
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (shouldTrackDocument(activeDocument)) {
    await Note.refresh(activeDocument);
  }

  await updateContextAsync();
  await tryAutoDecrypt(activeDocument);
};

export const deactivate = (): void => {};
