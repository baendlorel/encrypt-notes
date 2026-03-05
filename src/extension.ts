import * as vscode from 'vscode';

import { getExtensionConfig, isSupportedByExtensionList } from './lib/config.js';
import { decryptText, encryptText, isEncryptedText } from './lib/crypto.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './lib/errors.js';

const CONTEXT_SUPPORTED_DOCUMENT = 'encryptedNotes.supportedDocument';
const CONTEXT_IS_ENCRYPTED_DOCUMENT = 'encryptedNotes.isEncryptedDocument';

const passwordCache = new Map<string, string>();
const decryptedSession = new Set<string>();
const skippedAutoDecrypt = new Set<string>();
const decryptPromptInProgress = new Set<string>();

const getUriKey = (uri: vscode.Uri): string => uri.toString();

const getDocumentRange = (document: vscode.TextDocument): vscode.Range => {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
};

const showError = (message: string): void => {
  void vscode.window.showErrorMessage(message);
};

const showInfo = (message: string): void => {
  void vscode.window.showInformationMessage(message);
};

const isExtensionEnabled = (): boolean => getExtensionConfig().enabled;

const isSupportedDocument = (document: vscode.TextDocument): boolean => {
  if (!isExtensionEnabled() || document.uri.scheme !== 'file') {
    return false;
  }

  return (
    isEncryptedText(document.getText()) ||
    isSupportedByExtensionList(document) ||
    decryptedSession.has(getUriKey(document.uri))
  );
};

const promptPassword = async (prompt: string): Promise<string | undefined> => {
  const password = await vscode.window.showInputBox({
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.length === 0 ? '密码不能为空。' : undefined),
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

  if (!activeDocument) {
    await vscode.commands.executeCommand('setContext', CONTEXT_SUPPORTED_DOCUMENT, false);
    await vscode.commands.executeCommand('setContext', CONTEXT_IS_ENCRYPTED_DOCUMENT, false);
    return;
  }

  const isEncrypted = isEncryptedText(activeDocument.getText());
  const supported = isSupportedDocument(activeDocument);

  await vscode.commands.executeCommand('setContext', CONTEXT_SUPPORTED_DOCUMENT, supported);
  await vscode.commands.executeCommand('setContext', CONTEXT_IS_ENCRYPTED_DOCUMENT, isEncrypted);
};

const decryptWithPassword = async (
  document: vscode.TextDocument,
  password: string,
  showSuccessMessage: boolean,
): Promise<boolean> => {
  const uriKey = getUriKey(document.uri);

  try {
    const plainText = decryptText(document.getText(), password);
    const applied = await replaceDocumentText(document, plainText);

    if (!applied) {
      showError('无法将解密结果写入当前文档。');
      return false;
    }

    passwordCache.set(uriKey, password);
    decryptedSession.add(uriKey);
    skippedAutoDecrypt.delete(uriKey);

    if (showSuccessMessage) {
      showInfo('解密成功，后续保存时会自动重新加密。');
    }

    return true;
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      showError('密码错误，解密失败。');
      return false;
    }

    if (error instanceof InvalidEncryptedFileError) {
      showError(`文件格式损坏或不受支持：${error.message}`);
      return false;
    }

    showError('解密失败。');
    return false;
  }
};

const tryDecryptDocument = async (document: vscode.TextDocument, showSuccessMessage = true): Promise<boolean> => {
  const uriKey = getUriKey(document.uri);

  if (!isEncryptedText(document.getText())) {
    return false;
  }

  const cachedPassword = passwordCache.get(uriKey);
  if (cachedPassword && (await decryptWithPassword(document, cachedPassword, showSuccessMessage))) {
    return true;
  }

  const password = await promptPassword('请输入解密密码');
  if (!password) {
    return false;
  }

  return decryptWithPassword(document, password, showSuccessMessage);
};

const encryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  const uriKey = getUriKey(document.uri);

  if (!isSupportedDocument(document)) {
    showError('当前文件不在可加密的扩展名列表内。');
    return;
  }

  if (isEncryptedText(document.getText())) {
    showInfo('当前文件已经是加密状态。');
    return;
  }

  let password = passwordCache.get(uriKey);
  if (!password) {
    password = await promptPassword('请输入加密密码');
    if (!password) {
      return;
    }
  }

  const encryptedContent = encryptText(document.getText(), password);
  const applied = await replaceDocumentText(document, encryptedContent);

  if (!applied) {
    showError('无法将加密结果写入当前文档。');
    return;
  }

  decryptedSession.delete(uriKey);
  passwordCache.set(uriKey, password);

  const saved = await document.save();
  if (!saved) {
    showError('文件加密成功，但自动保存失败，请手动保存。');
  } else {
    showInfo('已加密并保存当前文件。');
  }
};

const decryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  if (!isEncryptedText(document.getText())) {
    const uriKey = getUriKey(document.uri);

    if (decryptedSession.has(uriKey)) {
      showInfo('当前文件已经是解密状态，保存时会自动加密。');
      return;
    }

    showInfo('当前文件不是加密格式。');
    return;
  }

  await tryDecryptDocument(document);
};

const runCommandForActiveDocument = async (mode: 'encrypt' | 'decrypt' | 'toggle'): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError('没有可操作的活动编辑器。');
    return;
  }

  const document = editor.document;
  if (document.uri.scheme !== 'file') {
    showError('仅支持本地文件。');
    return;
  }

  if (!isExtensionEnabled()) {
    showError('扩展当前处于禁用状态，请先开启 encrypted-notes.enabled。');
    return;
  }

  if (mode === 'encrypt') {
    await encryptCurrentDocument(document);
    await updateEditorContext();
    return;
  }

  if (mode === 'decrypt') {
    await decryptCurrentDocument(document);
    await updateEditorContext();
    return;
  }

  if (isEncryptedText(document.getText())) {
    await decryptCurrentDocument(document);
  } else {
    await encryptCurrentDocument(document);
  }

  await updateEditorContext();
};

const tryAutoDecrypt = async (document: vscode.TextDocument): Promise<void> => {
  const uriKey = getUriKey(document.uri);

  if (!isExtensionEnabled() || document.uri.scheme !== 'file') {
    return;
  }

  if (!isEncryptedText(document.getText())) {
    return;
  }

  if (decryptPromptInProgress.has(uriKey) || skippedAutoDecrypt.has(uriKey)) {
    return;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument || getUriKey(activeDocument.uri) !== uriKey) {
    return;
  }

  decryptPromptInProgress.add(uriKey);

  try {
    const success = await tryDecryptDocument(document, false);

    if (!success) {
      skippedAutoDecrypt.add(uriKey);
    }
  } finally {
    decryptPromptInProgress.delete(uriKey);
    await updateEditorContext();
  }
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  context.subscriptions.push(
    vscode.commands.registerCommand('encrypted-notes.toggleEncryption', async () =>
      runCommandForActiveDocument('toggle'),
    ),
    vscode.commands.registerCommand('encrypted-notes.encryptCurrent', async () =>
      runCommandForActiveDocument('encrypt'),
    ),
    vscode.commands.registerCommand('encrypted-notes.decryptCurrent', async () =>
      runCommandForActiveDocument('decrypt'),
    ),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void tryAutoDecrypt(document);
      void updateEditorContext();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        void tryAutoDecrypt(editor.document);
      }

      void updateEditorContext();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uriKey = getUriKey(event.document.uri);

      if (isEncryptedText(event.document.getText())) {
        decryptedSession.delete(uriKey);
      }

      if (vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
        void updateEditorContext();
      }
    }),
    vscode.workspace.onWillSaveTextDocument((event) => {
      const document = event.document;
      const uriKey = getUriKey(document.uri);
      const password = passwordCache.get(uriKey);

      if (!isExtensionEnabled()) {
        return;
      }

      if (!decryptedSession.has(uriKey) || !password || !isSupportedDocument(document)) {
        return;
      }

      if (isEncryptedText(document.getText())) {
        decryptedSession.delete(uriKey);
        return;
      }

      event.waitUntil(
        (async () => {
          const encryptedContent = encryptText(document.getText(), password);
          decryptedSession.delete(uriKey);
          return [vscode.TextEdit.replace(getDocumentRange(document), encryptedContent)];
        })(),
      );
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const uriKey = getUriKey(document.uri);

      if (isEncryptedText(document.getText())) {
        decryptedSession.delete(uriKey);
        vscode.window.setStatusBarMessage('Encrypted Notes: 文件已按加密格式保存。', 1800);
      }

      if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
        void updateEditorContext();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const uriKey = getUriKey(document.uri);
      passwordCache.delete(uriKey);
      decryptedSession.delete(uriKey);
      skippedAutoDecrypt.delete(uriKey);
      decryptPromptInProgress.delete(uriKey);

      void updateEditorContext();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('encrypted-notes')) {
        return;
      }

      void updateEditorContext();

      const activeDocument = vscode.window.activeTextEditor?.document;
      if (activeDocument) {
        void tryAutoDecrypt(activeDocument);
      }
    }),
  );

  await updateEditorContext();

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument) {
    await tryAutoDecrypt(activeDocument);
  }
};

export const deactivate = (): void => {};
