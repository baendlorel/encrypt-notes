import * as vscode from 'vscode';

import { Commands } from './core/consts.js';
import { configs } from './core/config.js';
import { decryptText, encryptText, isEncryptedText } from './lib/crypto.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './lib/errors.js';
import { t } from './i18n/index.js';
import { vsc } from './core/methods.js';
import { ve } from './virtual-edit/methods.js';
import { EncryptNotesProvider } from './virtual-edit/virtual-edit.js';
import { notes } from './virtual-edit/state.js';

const passwordCache = new Map<string, string>();
const decryptedSession = new Set<string>(); // refactor 只has过一次
const skippedAutoDecrypt = new Set<string>();
const decryptPromptInProgress = new Set<string>();
const encryptedOnDiskState = new Map<string, boolean>();

const codeLensChangeEmitter = new vscode.EventEmitter<void>();

const refreshEncryptedOnDiskState = async (document: vscode.TextDocument): Promise<void> => {
  const sourceUri = ve.getSourceUri(document.uri);
  if (sourceUri.scheme !== 'file') {
    return;
  }

  const sourceKey = ve.getUriKey(sourceUri);

  try {
    const raw = await vscode.workspace.fs.readFile(sourceUri);
    const content = Buffer.from(raw).toString('utf8');
    encryptedOnDiskState.set(sourceKey, isEncryptedText(content));
  } catch {
    if (document.uri.scheme === 'file') {
      encryptedOnDiskState.set(sourceKey, isEncryptedText(document.getText()));
    }
  }
};

const getEncryptedOnDiskState = (document: vscode.TextDocument): boolean => {
  const sourceKey = ve.getSourceUriKey(document.uri);
  const cached = encryptedOnDiskState.get(sourceKey);

  if (cached !== undefined) {
    return cached;
  }

  if (ve.isVirtual(document)) {
    return true;
  }

  return isEncryptedText(document.getText());
};

class EncryptionCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!configs.buttonOnFirstLine) {
      return [];
    }

    const sourceUri = ve.getSourceUri(document.uri);
    if (!configs.supports(sourceUri)) {
      return [];
    }

    const isSourceFile = document.uri.scheme === 'file';
    const encryptedOnDisk = getEncryptedOnDiskState(document);
    const canEncrypt = isSourceFile && !encryptedOnDisk;
    const canDecrypt = (isSourceFile && encryptedOnDisk) || ve.isVirtual(document);

    if (!canEncrypt && !canDecrypt) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];

    if (canEncrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: t('codelens.encrypt'),
          command: Commands.Encrypt,
          arguments: [document.uri],
        }),
      );
    }

    if (canDecrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: t('codelens.decrypt'),
          command: Commands.Decrypt,
          arguments: [document.uri],
        }),
      );
    }

    return lenses;
  }
}

const isSupportedDocument = (document: vscode.TextDocument): boolean => {
  const sourceUri = ve.getSourceUri(document.uri);
  if (sourceUri.scheme !== 'file') {
    return false;
  }

  const sourceKey = ve.getSourceUriKey(document.uri);

  return (
    getEncryptedOnDiskState(document) ||
    isEncryptedText(document.getText()) ||
    configs.supports(sourceUri) ||
    decryptedSession.has(sourceKey)
  );
};

const promptPassword = async (prompt: string): Promise<string | undefined> => {
  const password = await vscode.window.showInputBox({
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.length === 0 ? t('prompt.passwordRequired') : undefined),
  });

  if (password === undefined || password.length === 0) {
    return undefined;
  }

  return password;
};

const confirmPermanentDecryptByPassword = async (document: vscode.TextDocument): Promise<string | undefined> => {
  const password = await promptPassword(t('prompt.permanentDecryptConfirmPassword'));
  if (!password) {
    return undefined;
  }

  const sourceUri = ve.getSourceUri(document.uri);
  const sourceKey = ve.getUriKey(sourceUri);
  const cachedPassword = passwordCache.get(sourceKey);

  if (cachedPassword && cachedPassword === password) {
    return password;
  }

  let encryptedContent: string;
  if (ve.isVirtual(document)) {
    try {
      const sourceRaw = await vscode.workspace.fs.readFile(sourceUri);
      encryptedContent = Buffer.from(sourceRaw).toString('utf8');
    } catch {
      vsc.showError(t('error.decrypt.failed'));
      return undefined;
    }
  } else {
    encryptedContent = document.getText();
  }

  try {
    decryptText(encryptedContent, password);
    return password;
  } catch (error) {
    showDecryptError(error);
    return undefined;
  }
};

const replaceDocumentText = async (document: vscode.TextDocument, nextContent: string): Promise<boolean> => {
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, range, nextContent);
  return vscode.workspace.applyEdit(edit);
};

const updateEditorContext = async (): Promise<void> => {
  const activeDocument = vscode.window.activeTextEditor?.document;

  await vsc.setContext('showCodeLensActions', configs.buttonOnFirstLine);
  await vsc.setContext('showTitleActions', configs.buttonOnEditorTitle);

  if (!activeDocument) {
    await vsc.setContext('canEncrypt', false);
    await vsc.setContext('canDecrypt', false);
    codeLensChangeEmitter.fire();
    return;
  }

  const supported = isSupportedDocument(activeDocument);
  const encryptedOnDisk = getEncryptedOnDiskState(activeDocument); // todo 疑似和上面的supported重复判定
  const isSourceFile = activeDocument.uri.scheme === 'file';
  const canEncrypt = supported && !encryptedOnDisk;
  const canDecrypt = supported && ((isSourceFile && encryptedOnDisk) || ve.isVirtual(activeDocument));

  await vsc.setContext('canEncrypt', canEncrypt);
  await vsc.setContext('canDecrypt', canDecrypt);
  codeLensChangeEmitter.fire();
};

const showDecryptError = (error: unknown): void => {
  if (error instanceof InvalidPasswordError) {
    vsc.showError(t('error.decrypt.invalidPassword'));
    return;
  }

  if (error instanceof InvalidEncryptedFileError) {
    vsc.showError(t('error.decrypt.invalidFile', error.message));
    return;
  }

  vsc.showError(t('error.decrypt.failed'));
};

const clearSessionState = (sourceKey: string): void => {
  passwordCache.delete(sourceKey);
  decryptedSession.delete(sourceKey);
  skippedAutoDecrypt.delete(sourceKey);
  decryptPromptInProgress.delete(sourceKey);
  encryptedOnDiskState.delete(sourceKey);
};

const openVirtualEditor = async (
  sourceDocument: vscode.TextDocument,
  password: string,
  showSuccessMessage: boolean,
): Promise<boolean> => {
  const note = notes.get(sourceDocument.uri);

  if (note?.sourceUri.scheme !== 'file') {
    vsc.showError(t('error.onlyLocalFile'));
    return false;
  }

  try {
    decryptText(sourceDocument.getText(), password);
  } catch (error) {
    showDecryptError(error);
    return false;
  }

  try {
    note.password = password;
    note.decryptedInSession = true;
    note.skippedAutoDecrypt = false;
    note.encryptedOnDisk = true;

    const targetViewColumn = vscode.window.activeTextEditor?.viewColumn;
    const virtualDocument = await vscode.workspace.openTextDocument(note.virtualUri);
    await vscode.window.showTextDocument(virtualDocument, { preview: false, viewColumn: targetViewColumn });
    await ve.closeTabsForUri(note.sourceUri);

    if (showSuccessMessage) {
      vsc.setStatusBar(t('info.decrypt.openVirtualSuccess'));
    }

    return true;
  } catch {
    vsc.showError(t('error.decrypt.openVirtualFailed'));
    return false;
  }
};

const tryDecryptDocument = async (document: vscode.TextDocument, showSuccessMessage = true): Promise<boolean> => {
  const sourceKey = ve.getSourceUriKey(document.uri);

  if (!isEncryptedText(document.getText())) {
    return false;
  }

  const cachedPassword = passwordCache.get(sourceKey);
  if (cachedPassword && (await openVirtualEditor(document, cachedPassword, showSuccessMessage))) {
    return true;
  }

  passwordCache.delete(sourceKey);

  const password = await promptPassword(t('prompt.decryptPassword'));
  if (!password) {
    return false;
  }

  return openVirtualEditor(document, password, showSuccessMessage);
};

const encrypt = async (document: vscode.TextDocument): Promise<void> => {
  if (ve.isVirtual(document)) {
    const saved = await document.save();
    if (saved) {
      vsc.setStatusBar(t('info.encrypt.savedFromVirtual'));
    } else {
      vsc.showError(t('error.save.retry'));
    }

    return;
  }

  const sourceUri = ve.getSourceUri(document.uri);
  const sourceKey = ve.getUriKey(sourceUri);

  if (!configs.supports(sourceUri)) {
    vsc.showError(t('error.encrypt.unsupportedExtension'));
    return;
  }

  if (isEncryptedText(document.getText())) {
    vsc.setStatusBar(t('info.encrypt.alreadyEncrypted'));
    return;
  }

  let password = passwordCache.get(sourceKey);
  if (!password) {
    password = await promptPassword(t('prompt.encryptPassword'));
    if (!password) {
      return;
    }
  }

  const plainText = document.getText();
  const encryptedContent = encryptText(plainText, password);
  const applied = await replaceDocumentText(document, encryptedContent);

  if (!applied) {
    vsc.showError(t('error.encrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    vsc.showError(t('error.encrypt.saveFailed'));
    return;
  }

  passwordCache.set(sourceKey, password);
  decryptedSession.add(sourceKey);
  encryptedOnDiskState.set(sourceKey, true);
  skippedAutoDecrypt.delete(sourceKey);

  const encryptedDocument = await vscode.workspace.openTextDocument(sourceUri);
  const opened = await openVirtualEditor(encryptedDocument, password, false);
  if (opened) {
    vsc.setStatusBar(t('info.encrypt.savedAndContinueDecrypted'));
  }
};

const decrypt = async (document: vscode.TextDocument): Promise<void> => {
  const sourceUri = ve.getSourceUri(document.uri);
  const sourceKey = ve.getUriKey(sourceUri);

  if (ve.isVirtual(document)) {
    const plainText = document.getText();

    try {
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(plainText, 'utf8'));
    } catch {
      vsc.showError(t('error.permanentDecrypt.writePlainFailed'));
      return;
    }

    passwordCache.delete(sourceKey);
    decryptedSession.delete(sourceKey);
    skippedAutoDecrypt.delete(sourceKey);
    decryptPromptInProgress.delete(sourceKey);
    encryptedOnDiskState.set(sourceKey, false);

    const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(sourceDocument, {
      preview: false,
      viewColumn: vscode.window.activeTextEditor?.viewColumn,
    });
    await ve.closeTabsForUri(document.uri);

    vsc.setStatusBar(t('info.permanentDecrypt.saved'));
    return;
  }

  if (!isEncryptedText(document.getText())) {
    vsc.setStatusBar(t('info.permanentDecrypt.notNeeded'));
    return;
  }

  const cachedPassword = passwordCache.get(sourceKey);
  const password = cachedPassword ?? (await promptPassword(t('prompt.decryptPassword')));
  if (!password) {
    return;
  }

  let plainText: string;
  try {
    plainText = decryptText(document.getText(), password);
  } catch (error) {
    showDecryptError(error);
    return;
  }

  const applied = await replaceDocumentText(document, plainText);
  if (!applied) {
    vsc.showError(t('error.permanentDecrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    vsc.showError(t('error.permanentDecrypt.saveFailed'));
    return;
  }

  passwordCache.delete(sourceKey);
  decryptedSession.delete(sourceKey);
  skippedAutoDecrypt.delete(sourceKey);
  decryptPromptInProgress.delete(sourceKey);
  encryptedOnDiskState.set(sourceKey, false);

  vsc.setStatusBar(t('info.permanentDecrypt.saved'));
};

const handleActiveDocument = async (mode: 'encrypt' | 'decrypt'): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vsc.showError(t('error.noActiveEditor'));
    return;
  }

  const document = editor.document;
  if (document.uri.scheme !== 'file' && !ve.isVirtual(document)) {
    vsc.showError(t('error.onlyLocalFile'));
    return;
  }

  if (mode === 'encrypt') {
    await encrypt(document);
    await updateEditorContext();
    return;
  }

  if (mode === 'decrypt') {
    if (!ve.isVirtual(document) && !isEncryptedText(document.getText())) {
      vsc.setStatusBar(t('info.permanentDecrypt.notNeeded'));
      return;
    }

    const confirmedPassword = await confirmPermanentDecryptByPassword(document);
    if (!confirmedPassword) {
      return;
    }

    passwordCache.set(ve.getSourceUriKey(document.uri), confirmedPassword);
    await decrypt(document);
    await updateEditorContext();
    return;
  }
};

const tryAutoDecrypt = async (document?: vscode.TextDocument): Promise<void> => {
  if (document?.uri.scheme !== 'file') {
    return;
  }

  const sourceKey = ve.getUriKey(document.uri);

  if (!isEncryptedText(document.getText())) {
    encryptedOnDiskState.set(sourceKey, false);
    return;
  }

  encryptedOnDiskState.set(sourceKey, true);

  if (decryptPromptInProgress.has(sourceKey) || skippedAutoDecrypt.has(sourceKey)) {
    return;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument || ve.getSourceUriKey(activeDocument.uri) !== sourceKey) {
    return;
  }

  decryptPromptInProgress.add(sourceKey);

  try {
    const success = await tryDecryptDocument(document, false);

    if (!success) {
      skippedAutoDecrypt.add(sourceKey);
    }
  } finally {
    decryptPromptInProgress.delete(sourceKey);
    await updateEditorContext();
  }
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  // Load configurations
  configs.update();

  context.subscriptions.push(
    codeLensChangeEmitter,
    vscode.workspace.registerFileSystemProvider(
      ve.Scheme,
      new EncryptNotesProvider({
        passwordCache,
        encryptedOnDiskState,
        decryptedSession,
        decryptText,
        encryptText,
        isEncryptedText,
      }),
      {
        isCaseSensitive: true,
      },
    ),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: ve.Scheme }],
      new EncryptionCodeLensProvider(),
    ),
    vscode.commands.registerCommand('encrypted-notes.encrypt', () => handleActiveDocument('encrypt')),
    vscode.commands.registerCommand('encrypted-notes.decrypt', () => handleActiveDocument('decrypt')),
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await refreshEncryptedOnDiskState(document);
      await tryAutoDecrypt(document);
      await updateEditorContext();
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        await refreshEncryptedOnDiskState(editor.document);
        await tryAutoDecrypt(editor.document);
      }

      await updateEditorContext();
    }),
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      for (const { input } of event.closed) {
        if (input instanceof vscode.TabInputText) {
          await notes.closeAll(input.uri);
        }
      }
      updateEditorContext();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
        updateEditorContext();
      }
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await refreshEncryptedOnDiskState(document);

      const sourceKey = ve.getSourceUriKey(document.uri);
      if (ve.isVirtual(document)) {
        encryptedOnDiskState.set(sourceKey, true);
        decryptedSession.add(sourceKey);
        vscode.window.setStatusBarMessage(t('status.savedEncrypted'), 1600);
      }

      if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
        await updateEditorContext();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const sourceUri = ve.getSourceUri(document.uri);
      const sourceKey = ve.getUriKey(sourceUri);

      if (ve.isVirtual(document)) {
        clearSessionState(sourceKey);
        updateEditorContext();
        return;
      }

      if (!ve.hasOpenTabForSource(sourceUri)) {
        clearSessionState(sourceKey);
        updateEditorContext();
        return;
      }

      updateEditorContext();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('encrypted-notes')) {
        return;
      }

      updateEditorContext();

      const activeDocument = vscode.window.activeTextEditor?.document;
      tryAutoDecrypt(activeDocument);
    }),
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument) {
    await refreshEncryptedOnDiskState(activeDocument);
  }

  await updateEditorContext();

  await tryAutoDecrypt(activeDocument);
};

export const deactivate = (): void => {};
