import * as vscode from 'vscode';

import { CODELENS_DECRYPT_COMMAND, CODELENS_ENCRYPT_COMMAND, Consts, ContextKey } from './lib/consts.js';
import { getExtensionConfig, isSupportedByUriExtensionList } from './lib/config.js';
import { decryptText, encryptText, isEncryptedText } from './lib/crypto.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './lib/errors.js';
import { t } from './i18n/index.js';
import {
  closeTabsForUri,
  EncryptedVirtualFileSystemProvider,
  getSourceUri,
  getSourceUriKey,
  getUriKey,
  hasOpenTabForSource,
  isVirtualDocument,
  toVirtualUri,
} from './core/virtual-edit.js';

const passwordCache = new Map<string, string>();
const decryptedSession = new Set<string>();
const skippedAutoDecrypt = new Set<string>();
const decryptPromptInProgress = new Set<string>();
const encryptedOnDiskState = new Map<string, boolean>();
const codeLensChangeEmitter = new vscode.EventEmitter<void>();

const getCodeLensEncryptTitle = (): string => t('codelens.encrypt');
const getCodeLensDecryptTitle = (): string => t('codelens.decrypt');

const getCodeLensAnchorRange = (document: vscode.TextDocument): vscode.Range => {
  const line = Math.max(0, Math.min(document.lineCount - 1, 0));
  return new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
};

const triggerCodeLensRefresh = (): void => {
  codeLensChangeEmitter.fire();
};

const getDocumentRange = (document: vscode.TextDocument): vscode.Range => {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
};

const showError = (message: string): void => {
  void vscode.window.showErrorMessage(message);
};

const showInfo = (message: string): void => {
  void vscode.window.showInformationMessage(message);
};

const confirmPermanentDecrypt = async (): Promise<boolean> => {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: t('confirm.permanentDecrypt.continue'),
        description: t('confirm.permanentDecrypt.optionDescription'),
        value: 'continue',
      },
      {
        label: t('confirm.permanentDecrypt.cancel'),
        value: 'cancel',
      },
    ],
    {
      title: t('confirm.permanentDecrypt.title'),
      ignoreFocusOut: true,
    },
  );

  return selected?.value === 'continue';
};

const isExtensionEnabled = (): boolean => getExtensionConfig().enabled;

const refreshEncryptedOnDiskState = async (document: vscode.TextDocument): Promise<void> => {
  const sourceUri = getSourceUri(document.uri);
  if (sourceUri.scheme !== 'file') {
    return;
  }

  const sourceKey = getUriKey(sourceUri);

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
  const sourceKey = getSourceUriKey(document.uri);
  const cached = encryptedOnDiskState.get(sourceKey);

  if (cached !== undefined) {
    return cached;
  }

  if (isVirtualDocument(document)) {
    return true;
  }

  return isEncryptedText(document.getText());
};

class EncryptionCodeLensProvider implements vscode.CodeLensProvider {
  public readonly onDidChangeCodeLenses = codeLensChangeEmitter.event;

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isExtensionEnabled() || !isCodeLensActionLocation()) {
      return [];
    }

    const sourceUri = getSourceUri(document.uri);
    if (sourceUri.scheme !== 'file' || !isSupportedByUriExtensionList(sourceUri)) {
      return [];
    }

    const isSourceFile = document.uri.scheme === 'file';
    const encryptedOnDisk = getEncryptedOnDiskState(document);
    const canEncrypt = isSourceFile && !encryptedOnDisk;
    const canDecrypt = (isSourceFile && encryptedOnDisk) || isVirtualDocument(document);

    if (!canEncrypt && !canDecrypt) {
      return [];
    }

    const range = getCodeLensAnchorRange(document);
    const lenses: vscode.CodeLens[] = [];

    if (canEncrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: getCodeLensEncryptTitle(),
          command: CODELENS_ENCRYPT_COMMAND,
          arguments: [document.uri],
        }),
      );
    }

    if (canDecrypt) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: getCodeLensDecryptTitle(),
          command: CODELENS_DECRYPT_COMMAND,
          arguments: [document.uri],
        }),
      );
    }

    return lenses;
  }
}

const isSupportedDocument = (document: vscode.TextDocument): boolean => {
  if (!isExtensionEnabled()) {
    return false;
  }

  const sourceUri = getSourceUri(document.uri);
  if (sourceUri.scheme !== 'file') {
    return false;
  }

  const sourceKey = getSourceUriKey(document.uri);

  return (
    getEncryptedOnDiskState(document) ||
    isEncryptedText(document.getText()) ||
    isSupportedByUriExtensionList(sourceUri) ||
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

const replaceDocumentText = async (document: vscode.TextDocument, nextContent: string): Promise<boolean> => {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, getDocumentRange(document), nextContent);
  return vscode.workspace.applyEdit(edit);
};

const updateEditorContext = async (): Promise<void> => {
  const activeDocument = vscode.window.activeTextEditor?.document;
  const config = getExtensionConfig();
  const showCodeLensActions = config.actionButtonLocation === 'firstLine';
  const showTitleActions = config.actionButtonLocation === 'editorTitle';

  await vscode.commands.executeCommand('setContext', ContextKey.ShowCodeLensActions, showCodeLensActions);
  await vscode.commands.executeCommand('setContext', ContextKey.ShowTitleActions, showTitleActions);

  if (!activeDocument || !isExtensionEnabled()) {
    await vscode.commands.executeCommand('setContext', ContextKey.SupportedDocument, false);
    await vscode.commands.executeCommand('setContext', ContextKey.IsEncryptedDocument, false);
    await vscode.commands.executeCommand('setContext', ContextKey.CanEncryptDocument, false);
    await vscode.commands.executeCommand('setContext', ContextKey.CanDecryptDocument, false);
    await vscode.commands.executeCommand('setContext', ContextKey.CanPermanentDecrypt, false);
    triggerCodeLensRefresh();
    return;
  }

  const sourceKey = getSourceUriKey(activeDocument.uri);
  const supported = isSupportedDocument(activeDocument);
  const encryptedOnDisk = getEncryptedOnDiskState(activeDocument);
  const encryptedInEditor = isEncryptedText(activeDocument.getText());
  const isSourceFile = activeDocument.uri.scheme === 'file';
  const canEncrypt = supported && !encryptedOnDisk;
  const canDecrypt = supported && ((isSourceFile && encryptedOnDisk) || isVirtualDocument(activeDocument));
  const canPermanentDecrypt = supported && encryptedOnDisk && decryptedSession.has(sourceKey);

  await vscode.commands.executeCommand('setContext', ContextKey.SupportedDocument, supported);
  await vscode.commands.executeCommand('setContext', ContextKey.IsEncryptedDocument, encryptedInEditor);
  await vscode.commands.executeCommand('setContext', ContextKey.CanEncryptDocument, canEncrypt);
  await vscode.commands.executeCommand('setContext', ContextKey.CanDecryptDocument, canDecrypt);
  await vscode.commands.executeCommand('setContext', ContextKey.CanPermanentDecrypt, canPermanentDecrypt);
  triggerCodeLensRefresh();
};

const showDecryptError = (error: unknown): void => {
  if (error instanceof InvalidPasswordError) {
    showError(t('error.decrypt.invalidPassword'));
    return;
  }

  if (error instanceof InvalidEncryptedFileError) {
    showError(t('error.decrypt.invalidFile', error.message));
    return;
  }

  showError(t('error.decrypt.failed'));
};

const openVirtualEditor = async (
  sourceDocument: vscode.TextDocument,
  password: string,
  showSuccessMessage: boolean,
): Promise<boolean> => {
  const sourceUri = getSourceUri(sourceDocument.uri);
  const sourceKey = getUriKey(sourceUri);

  if (sourceUri.scheme !== 'file') {
    showError(t('error.onlyLocalFile'));
    return false;
  }

  try {
    decryptText(sourceDocument.getText(), password);
  } catch (error) {
    showDecryptError(error);
    return false;
  }

  try {
    passwordCache.set(sourceKey, password);
    decryptedSession.add(sourceKey);
    skippedAutoDecrypt.delete(sourceKey);
    encryptedOnDiskState.set(sourceKey, true);

    const virtualUri = toVirtualUri(sourceUri);
    const targetViewColumn = vscode.window.activeTextEditor?.viewColumn;
    const virtualDocument = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.window.showTextDocument(virtualDocument, { preview: false, viewColumn: targetViewColumn });
    await closeTabsForUri(sourceUri);

    if (showSuccessMessage) {
      showInfo(t('info.decrypt.openVirtualSuccess'));
    }

    return true;
  } catch {
    showError(t('error.decrypt.openVirtualFailed'));
    return false;
  }
};

const tryDecryptDocument = async (document: vscode.TextDocument, showSuccessMessage = true): Promise<boolean> => {
  const sourceKey = getSourceUriKey(document.uri);

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

const encryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  if (isVirtualDocument(document)) {
    const saved = await document.save();
    if (saved) {
      showInfo(t('info.encrypt.savedFromVirtual'));
    } else {
      showError(t('error.save.retry'));
    }

    return;
  }

  const sourceUri = getSourceUri(document.uri);
  const sourceKey = getUriKey(sourceUri);

  if (!isSupportedByUriExtensionList(sourceUri)) {
    showError(t('error.encrypt.unsupportedExtension'));
    return;
  }

  if (isEncryptedText(document.getText())) {
    showInfo(t('info.encrypt.alreadyEncrypted'));
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
    showError(t('error.encrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    showError(t('error.encrypt.saveFailed'));
    return;
  }

  passwordCache.set(sourceKey, password);
  decryptedSession.add(sourceKey);
  encryptedOnDiskState.set(sourceKey, true);
  skippedAutoDecrypt.delete(sourceKey);

  const encryptedDocument = await vscode.workspace.openTextDocument(sourceUri);
  const opened = await openVirtualEditor(encryptedDocument, password, false);
  if (opened) {
    showInfo(t('info.encrypt.savedAndContinueDecrypted'));
  }
};

const decryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  if (isVirtualDocument(document)) {
    showInfo(t('info.decrypt.alreadyVirtual'));
    return;
  }

  if (!isEncryptedText(document.getText())) {
    showInfo(t('info.decrypt.notEncrypted'));
    return;
  }

  await tryDecryptDocument(document);
};

const permanentlyDecryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  const sourceUri = getSourceUri(document.uri);
  const sourceKey = getUriKey(sourceUri);

  if (isVirtualDocument(document)) {
    const plainText = document.getText();

    try {
      await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(plainText, 'utf8'));
    } catch {
      showError(t('error.permanentDecrypt.writePlainFailed'));
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
    await closeTabsForUri(document.uri);

    showInfo(t('info.permanentDecrypt.saved'));
    return;
  }

  if (!isEncryptedText(document.getText())) {
    showInfo(t('info.permanentDecrypt.notNeeded'));
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
    showError(t('error.permanentDecrypt.applyFailed'));
    return;
  }

  const saved = await document.save();
  if (!saved) {
    showError(t('error.permanentDecrypt.saveFailed'));
    return;
  }

  passwordCache.delete(sourceKey);
  decryptedSession.delete(sourceKey);
  skippedAutoDecrypt.delete(sourceKey);
  decryptPromptInProgress.delete(sourceKey);
  encryptedOnDiskState.set(sourceKey, false);

  showInfo(t('info.permanentDecrypt.saved'));
};

const resolveOpenDocumentByUri = async (uri: vscode.Uri): Promise<vscode.TextDocument> => {
  const uriKey = getUriKey(uri);
  const opened = vscode.workspace.textDocuments.find((item) => getUriKey(item.uri) === uriKey);
  if (opened) {
    return opened;
  }

  return vscode.workspace.openTextDocument(uri);
};

const runCommandForDocument = async (document: vscode.TextDocument, mode: 'encrypt' | 'decrypt'): Promise<void> => {
  if (document.uri.scheme !== 'file' && !isVirtualDocument(document)) {
    showError(t('error.onlyLocalFile'));
    return;
  }

  if (!isExtensionEnabled()) {
    showError(t('error.extension.disabled'));
    return;
  }

  if (mode === 'encrypt') {
    await encryptCurrentDocument(document);
    await updateEditorContext();
    return;
  }

  if (mode === 'decrypt') {
    const confirmed = await confirmPermanentDecrypt();
    if (!confirmed) {
      return;
    }
    await decryptCurrentDocument(document);
    await updateEditorContext();
    return;
  }

  // if (isEncryptedText(document.getText())) {
  //   await decryptCurrentDocument(document);
  // } else {
  //   await encryptCurrentDocument(document);
  // }

  // await updateEditorContext();
};

const runCommandForActiveDocument = async (mode: 'encrypt' | 'decrypt'): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError(t('error.noActiveEditor'));
    return;
  }

  await runCommandForDocument(editor.document, mode);
};

const tryAutoDecrypt = async (document: vscode.TextDocument): Promise<void> => {
  if (!isExtensionEnabled() || document.uri.scheme !== 'file') {
    return;
  }

  const sourceKey = getUriKey(document.uri);

  if (!isEncryptedText(document.getText())) {
    encryptedOnDiskState.set(sourceKey, false);
    return;
  }

  encryptedOnDiskState.set(sourceKey, true);

  if (decryptPromptInProgress.has(sourceKey) || skippedAutoDecrypt.has(sourceKey)) {
    return;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument || getSourceUriKey(activeDocument.uri) !== sourceKey) {
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

const runCodeLensEncryptCommand = async (targetUri: vscode.Uri | undefined): Promise<void> => {
  const document = targetUri ? await resolveOpenDocumentByUri(targetUri) : vscode.window.activeTextEditor?.document;
  if (!document) {
    showError(t('error.noActiveEditor'));
    return;
  }

  await runCommandForDocument(document, 'encrypt');
};

const runCodeLensDecryptCommand = async (targetUri: vscode.Uri | undefined): Promise<void> => {
  const document = targetUri ? await resolveOpenDocumentByUri(targetUri) : vscode.window.activeTextEditor?.document;
  if (!document) {
    showError(t('error.noActiveEditor'));
    return;
  }

  await runCommandForDocument(document, 'permanentDecrypt');
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  context.subscriptions.push(
    codeLensChangeEmitter,
    vscode.workspace.registerFileSystemProvider(
      Consts.VDocScheme,
      new EncryptedVirtualFileSystemProvider({
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
      [{ scheme: 'file' }, { scheme: Consts.VDocScheme }],
      new EncryptionCodeLensProvider(),
    ),
    vscode.commands.registerCommand('encrypted-notes.encrypt', async () => runCommandForActiveDocument('encrypt')),
    vscode.commands.registerCommand('encrypted-notes.decrypt', async () => runCommandForActiveDocument('decrypt')),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void (async () => {
        await refreshEncryptedOnDiskState(document);

        if (document.uri.scheme === 'file') {
          await tryAutoDecrypt(document);
        }

        await updateEditorContext();
      })();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void (async () => {
        if (editor) {
          await refreshEncryptedOnDiskState(editor.document);

          if (editor.document.uri.scheme === 'file') {
            await tryAutoDecrypt(editor.document);
          }
        }

        await updateEditorContext();
      })();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
        void updateEditorContext();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void (async () => {
        await refreshEncryptedOnDiskState(document);

        const sourceKey = getSourceUriKey(document.uri);
        if (document.uri.scheme === Consts.VDocScheme) {
          encryptedOnDiskState.set(sourceKey, true);
          decryptedSession.add(sourceKey);
          vscode.window.setStatusBarMessage(t('status.savedEncrypted'), 1600);
        }

        if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
          await updateEditorContext();
        }
      })();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const sourceUri = getSourceUri(document.uri);
      const sourceKey = getUriKey(sourceUri);

      if (isVirtualDocument(document)) {
        passwordCache.delete(sourceKey);
        decryptedSession.delete(sourceKey);
        skippedAutoDecrypt.delete(sourceKey);
        decryptPromptInProgress.delete(sourceKey);
        encryptedOnDiskState.delete(sourceKey);
        void updateEditorContext();
        return;
      }

      if (!hasOpenTabForSource(sourceUri)) {
        passwordCache.delete(sourceKey);
        decryptedSession.delete(sourceKey);
        skippedAutoDecrypt.delete(sourceKey);
        decryptPromptInProgress.delete(sourceKey);
        encryptedOnDiskState.delete(sourceKey);
      }

      void updateEditorContext();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('encrypted-notes')) {
        return;
      }

      void updateEditorContext();

      const activeDocument = vscode.window.activeTextEditor?.document;
      if (activeDocument && activeDocument.uri.scheme === 'file') {
        void tryAutoDecrypt(activeDocument);
      }
    }),
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument) {
    await refreshEncryptedOnDiskState(activeDocument);
  }

  await updateEditorContext();

  if (activeDocument && activeDocument.uri.scheme === 'file') {
    await tryAutoDecrypt(activeDocument);
  }
};

export const deactivate = (): void => {};
