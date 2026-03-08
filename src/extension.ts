import * as vscode from 'vscode';

import { Commands, Consts, EncrytConfig } from './core/consts.js';
import { configs } from './core/config.js';
import { t } from './i18n/index.js';
import { NoteError } from './lib/errors.js';

import { vsc } from './core/methods.js';
import { ve } from './virtual-edit/methods.js';
import { Note } from './virtual-edit/state.js';
import { EncryptNotesProvider } from './virtual-edit/virtual-edit.js';
import { CrypNote } from './lib/crypto.js';

const passwordCache = new Map<string, string>();
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

const updateContextAsync = async (): Promise<void> => {
  const document = vscode.window.activeTextEditor?.document;

  await vsc.setContext('buttonOnEditorTitle', configs.buttonOnEditorTitle);

  let canEncrypt = false;
  let canDecrypt = false;

  if (document) {
    const supported =
      document.uri.scheme === EncrytConfig.UriScheme ||
      (document.uri.scheme === 'file' && configs.supports(document.uri));
    const encrypted = CrypNote.isEncrypted(document); // refactor 也许要看一下实际的文件内容
    const isSourceFile = document.uri.scheme === 'file';
    canEncrypt = supported && !encrypted;
    canDecrypt = supported && ((isSourceFile && encrypted) || Note.isVirtual(document));
  }

  await vsc.setContext('canEncrypt', canEncrypt);
  await vsc.setContext('canDecrypt', canDecrypt);

  codeLensChangeEmitter.fire();
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
    CrypNote.decrypt(sourceDocument.getText(), password);
  } catch (error) {
    NoteError.display(error);
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

  if (!CrypNote.isEncrypted(document)) {
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
  if (Note.isVirtual(document)) {
    const saved = await document.save();
    if (!saved) {
      vsc.showError(t('error.save.retry'));
      return;
    }

    const state = Note.get(document.uri);
    // refactor 这里要直接加密后写入真实文件
    vsc.setStatusBar(t('info.encrypt.savedFromVirtual'));

    return;
  }

  if (!configs.supports(document.uri)) {
    vsc.showError(t('error.encrypt.unsupportedExtension'));
    return;
  }

  if (CrypNote.isEncrypted(document)) {
    vsc.setStatusBar(t('info.encrypt.alreadyEncrypted'));
    return;
  }

  const state = Note.add(document.uri);
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
  const opened = await openVirtualEditor(encryptedDocument, password, false);
  if (opened) {
    vsc.setStatusBar(t('info.encrypt.savedAndContinueDecrypted'));
  }
};
const decrypt = async (document: vscode.TextDocument): Promise<void> => {
  const state = Note.get(document.uri);
  // refactor 解密，是否存在还没add过的uri就直接解密了？
  if (!state) {
    vsc.showError(t('error.decrypt.noVirtualState'));
    return;
  }

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
    await ve.closeTabsForUri(document.uri);

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

    const confirmedPassword = await confirmDecrypt(document);
    if (!confirmedPassword) {
      return;
    }

    Note.modify(document.uri, { password: confirmedPassword });
    await decrypt(document);
    await updateContextAsync();
    return;
  }
};

const tryAutoDecrypt = async (document?: vscode.TextDocument): Promise<void> => {
  if (document?.uri.scheme !== 'file') {
    return;
  }

  // refactor 尝试利用notes缩减，是否存在还没add就来try的？
  const state = Note.get(document.uri);
  if (!state) {
    vsc.showError(t('error.decrypt.noVirtualState'));
    return;
  }

  state.encrypted = CrypNote.isEncrypted(document);
  if (state.cannotDecrypt) {
    return;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument || activeDocument.uri.toString() !== state.sourceUri.toString()) {
    return;
  }

  state.locked = true;

  try {
    // refactor 这里会打开virtual editor
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
    codeLensChangeEmitter,
    vscode.workspace.registerFileSystemProvider(EncrytConfig.UriScheme, new EncryptNotesProvider(), {
      isCaseSensitive: true,
    }),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: EncrytConfig.UriScheme }],
      new EncryptionCodeLensProvider(),
    ),
    // & This is for menu editor/title to trigger
    vscode.commands.registerCommand('encrypted-notes.encrypt', () => handleActiveDocument('encrypt')),
    vscode.commands.registerCommand('encrypted-notes.decrypt', () => handleActiveDocument('decrypt')),

    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await Note.refresh(document);
      await tryAutoDecrypt(document);
      await updateContextAsync();
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      // refactor 切换活动的文本编辑器的时候触发
      if (editor) {
        await Note.refresh(editor.document);
        await tryAutoDecrypt(editor.document);
      }

      await updateContextAsync();
    }),
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      for (const { input } of event.closed) {
        if (input instanceof vscode.TabInputText) {
          await Note.closeRelatedTabs(input.uri);
        }
      }
      await updateContextAsync();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
        updateContextAsync();
      }
    }),
    // refactor 这里可能是控制自动保存的
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await Note.refresh(document);

      const state = Note.get(document.uri);
      if (!state) {
        vsc.showError(t('error.decrypt.noVirtualState'));
        return;
      }
      if (Note.isVirtual(document)) {
        state.encrypted = false;
        state.decryptedInSession = true;
        vscode.window.setStatusBarMessage(t('status.savedEncrypted'), 1600);
      }

      if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
        await updateContextAsync();
      }
    }),
    vscode.workspace.onDidCloseTextDocument(async (document) => {
      Note.remove(document.uri);
      await updateContextAsync();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(Consts.ExtensionId)) {
        return;
      }

      await updateContextAsync();
      await tryAutoDecrypt(vscode.window.activeTextEditor?.document);
    }),
  );

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument) {
    await Note.refresh(activeDocument);
  }

  await updateContextAsync();
  await tryAutoDecrypt(activeDocument);
};

export const deactivate = (): void => {};
