import * as vscode from 'vscode';

import { Commands, EncrytConfig } from './core/consts.js';
import { configs } from './core/config.js';
import { t } from './i18n/index.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './lib/errors.js';

import { vsc } from './core/methods.js';
import { ve } from './virtual-edit/methods.js';
import { Note } from './virtual-edit/state.js';
import { EncryptNotesProvider } from './virtual-edit/virtual-edit.js';
import { CrypNote } from './lib/crypto.js';

const passwordCache = new Map<string, string>();
const decryptedSession = new Set<string>(); // refactor 只has过一次
const skippedAutoDecrypt = new Set<string>();
const decryptPromptInProgress = new Set<string>();
const encryptedOnDiskState = new Map<string, boolean>();

const codeLensChangeEmitter = new vscode.EventEmitter<void>();

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
    // todo 如果文件在外部变化，可能这里也要侦听
    const encryptedOnDisk = getEncryptedOnDiskState(document); // refactor 这里读取文件加上
    const canEncrypt = isSourceFile && !encryptedOnDisk;
    const canDecrypt = (isSourceFile && encryptedOnDisk) || Note.isVirtual(document);

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

const confirmDecrypt = async (document: vscode.TextDocument): Promise<string | undefined> => {
  const password = await promptPassword(t('prompt.confirmDecrypt'));
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
  if (Note.isVirtual(document)) {
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
    CrypNote.decrypt(encryptedContent, password);
    return password; // ?? 这里怎么返回密码？
  } catch (error) {
    showDecryptError(error);
    return undefined;
  }
};

const apply = async (document: vscode.TextDocument, nextContent: string): Promise<boolean> => {
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, range, nextContent);
  return vscode.workspace.applyEdit(edit);
};

const updateEditorContext = async (): Promise<void> => {
  const document = vscode.window.activeTextEditor?.document;

  await vsc.setContext('buttonOnEditorTitle', configs.buttonOnEditorTitle);

  let canEncrypt = false;
  let canDecrypt = false;

  if (document) {
    const supported =
      document.uri.scheme === EncrytConfig.UriScheme ||
      (document.uri.scheme === 'file' && configs.supports(document.uri));
    const encryptedOnDisk = CrypNote.isEncrypted(document.getText()); // refactor 也许要看一下实际的文件内容
    const isSourceFile = document.uri.scheme === 'file';
    canEncrypt = supported && !encryptedOnDisk;
    canDecrypt = supported && ((isSourceFile && encryptedOnDisk) || Note.isVirtual(document));
  }

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
  const note = Note.get(sourceDocument.uri);

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
    note.encrypted = true;

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

const tryDecrypt = async (document: vscode.TextDocument, showSuccessMessage = true): Promise<boolean> => {
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

    const confirmedPassword = await confirmDecrypt(document);
    if (!confirmedPassword) {
      return;
    }

    passwordCache.set(ve.getSourceUriKey(document.uri), confirmedPassword);
    await decrypt(document);
    await updateEditorContext();
    return;
  }
};

// refactor 尝试利用notes缩减
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
    // refactor 这里会打开virtual editor
    const success = await tryDecrypt(document, false);

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
      await Note.refresh(document);
      await tryAutoDecrypt(document);
      await updateEditorContext();
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      // refactor 切换活动的文本编辑器的时候触发
      if (editor) {
        await Note.refresh(editor.document);
        await tryAutoDecrypt(editor.document);
      }

      await updateEditorContext();
    }),
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      for (const { input } of event.closed) {
        if (input instanceof vscode.TabInputText) {
          await Note.closeRelatedTabs(input.uri);
        }
      }
      await updateEditorContext();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
        updateEditorContext();
      }
    }),
    // refactor 这里可能是控制自动保存的
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await Note.refresh(document);

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
    await Note.refresh(activeDocument);
  }

  await updateEditorContext();

  await tryAutoDecrypt(activeDocument);
};

export const deactivate = (): void => {};
