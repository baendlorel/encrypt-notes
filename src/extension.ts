import * as vscode from 'vscode';

import { getExtensionConfig, isSupportedByUriExtensionList } from './lib/config.js';
import { decryptText, encryptText, isEncryptedText } from './lib/crypto.js';
import { InvalidEncryptedFileError, InvalidPasswordError } from './lib/errors.js';

const VIRTUAL_DOCUMENT_SCHEME = 'encrypted-notes-decrypted';

const CONTEXT_SUPPORTED_DOCUMENT = 'encryptedNotes.supportedDocument';
const CONTEXT_IS_ENCRYPTED_DOCUMENT = 'encryptedNotes.isEncryptedDocument';
const CONTEXT_CAN_ENCRYPT_DOCUMENT = 'encryptedNotes.canEncryptDocument';
const CONTEXT_CAN_PERMANENT_DECRYPT = 'encryptedNotes.canPermanentDecrypt';

const passwordCache = new Map<string, string>();
const decryptedSession = new Set<string>();
const skippedAutoDecrypt = new Set<string>();
const decryptPromptInProgress = new Set<string>();
const encryptedOnDiskState = new Map<string, boolean>();

const getUriKey = (uri: vscode.Uri): string => uri.toString();

const getDecryptedDisplayPrefix = (): string => {
  const language = vscode.env.language.toLowerCase();
  return language.startsWith('zh') ? '[明文]' : '[Decrypted]';
};

const getVirtualDisplayPath = (sourceUri: vscode.Uri): string => {
  const sourcePath = sourceUri.path;
  const lastSlash = sourcePath.lastIndexOf('/');
  const directoryPath = lastSlash >= 0 ? sourcePath.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath;

  if (filename.length === 0) {
    return sourcePath;
  }

  return `${directoryPath}${getDecryptedDisplayPrefix()}${filename}`;
};

const parseSourceUriFromVirtualUri = (uri: vscode.Uri): vscode.Uri | undefined => {
  if (uri.scheme !== VIRTUAL_DOCUMENT_SCHEME || uri.query.length === 0) {
    return undefined;
  }

  try {
    const decoded = decodeURIComponent(uri.query);
    const parsed = vscode.Uri.parse(decoded);
    return parsed.scheme === 'file' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const getSourceUri = (uri: vscode.Uri): vscode.Uri => {
  return parseSourceUriFromVirtualUri(uri) ?? uri;
};

const getSourceUriKey = (uri: vscode.Uri): string => {
  return getUriKey(getSourceUri(uri));
};

const toVirtualUri = (sourceUri: vscode.Uri): vscode.Uri => {
  return sourceUri.with({
    scheme: VIRTUAL_DOCUMENT_SCHEME,
    path: getVirtualDisplayPath(sourceUri),
    query: encodeURIComponent(sourceUri.toString()),
    fragment: '',
  });
};

const getRequiredSourceUriFromVirtualUri = (uri: vscode.Uri): vscode.Uri => {
  const sourceUri = parseSourceUriFromVirtualUri(uri);
  if (!sourceUri) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  return sourceUri;
};

const isVirtualDocument = (document: vscode.TextDocument): boolean => {
  return document.uri.scheme === VIRTUAL_DOCUMENT_SCHEME;
};

const getTabsForUri = (uri: vscode.Uri): vscode.Tab[] => {
  const uriKey = getUriKey(uri);
  const tabs: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && getUriKey(tab.input.uri) === uriKey) {
        tabs.push(tab);
      }
    }
  }

  return tabs;
};

const closeTabsForUri = async (uri: vscode.Uri): Promise<void> => {
  const tabs = getTabsForUri(uri);
  if (tabs.length === 0) {
    return;
  }

  await vscode.window.tabGroups.close(tabs, true);
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

  if (!activeDocument || !isExtensionEnabled()) {
    await vscode.commands.executeCommand('setContext', CONTEXT_SUPPORTED_DOCUMENT, false);
    await vscode.commands.executeCommand('setContext', CONTEXT_IS_ENCRYPTED_DOCUMENT, false);
    await vscode.commands.executeCommand('setContext', CONTEXT_CAN_ENCRYPT_DOCUMENT, false);
    await vscode.commands.executeCommand('setContext', CONTEXT_CAN_PERMANENT_DECRYPT, false);
    return;
  }

  const sourceKey = getSourceUriKey(activeDocument.uri);
  const supported = isSupportedDocument(activeDocument);
  const encryptedOnDisk = getEncryptedOnDiskState(activeDocument);
  const encryptedInEditor = isEncryptedText(activeDocument.getText());
  const canEncrypt = supported && !encryptedOnDisk;
  const canPermanentDecrypt = supported && encryptedOnDisk && decryptedSession.has(sourceKey);

  await vscode.commands.executeCommand('setContext', CONTEXT_SUPPORTED_DOCUMENT, supported);
  await vscode.commands.executeCommand('setContext', CONTEXT_IS_ENCRYPTED_DOCUMENT, encryptedInEditor);
  await vscode.commands.executeCommand('setContext', CONTEXT_CAN_ENCRYPT_DOCUMENT, canEncrypt);
  await vscode.commands.executeCommand('setContext', CONTEXT_CAN_PERMANENT_DECRYPT, canPermanentDecrypt);
};

const showDecryptError = (error: unknown): void => {
  if (error instanceof InvalidPasswordError) {
    showError('密码错误，解密失败。');
    return;
  }

  if (error instanceof InvalidEncryptedFileError) {
    showError(`文件格式损坏或不受支持：${error.message}`);
    return;
  }

  showError('解密失败。');
};

const openVirtualEditor = async (
  sourceDocument: vscode.TextDocument,
  password: string,
  showSuccessMessage: boolean,
): Promise<boolean> => {
  const sourceUri = getSourceUri(sourceDocument.uri);
  const sourceKey = getUriKey(sourceUri);

  if (sourceUri.scheme !== 'file') {
    showError('仅支持本地文件。');
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
      showInfo('解密成功，当前为解密编辑视图，保存时会自动加密写入磁盘。');
    }

    return true;
  } catch {
    showError('无法打开解密编辑视图。');
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

  const password = await promptPassword('请输入解密密码');
  if (!password) {
    return false;
  }

  return openVirtualEditor(document, password, showSuccessMessage);
};

const encryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  if (isVirtualDocument(document)) {
    const saved = await document.save();
    if (saved) {
      showInfo('当前为解密编辑视图，内容已按加密格式写入磁盘。');
    } else {
      showError('自动保存失败，请重试。');
    }

    return;
  }

  const sourceUri = getSourceUri(document.uri);
  const sourceKey = getUriKey(sourceUri);

  if (!isSupportedByUriExtensionList(sourceUri)) {
    showError('当前文件不在可加密的扩展名列表内。');
    return;
  }

  if (isEncryptedText(document.getText())) {
    showInfo('当前文件已经是加密状态。');
    return;
  }

  let password = passwordCache.get(sourceKey);
  if (!password) {
    password = await promptPassword('请输入加密密码');
    if (!password) {
      return;
    }
  }

  const plainText = document.getText();
  const encryptedContent = encryptText(plainText, password);
  const applied = await replaceDocumentText(document, encryptedContent);

  if (!applied) {
    showError('无法将加密结果写入当前文档。');
    return;
  }

  const saved = await document.save();
  if (!saved) {
    showError('文件加密成功，但自动保存失败，请手动保存。');
    return;
  }

  passwordCache.set(sourceKey, password);
  decryptedSession.add(sourceKey);
  encryptedOnDiskState.set(sourceKey, true);
  skippedAutoDecrypt.delete(sourceKey);

  const encryptedDocument = await vscode.workspace.openTextDocument(sourceUri);
  const opened = await openVirtualEditor(encryptedDocument, password, false);
  if (opened) {
    showInfo('已加密并保存，当前以解密视图继续编辑。');
  }
};

const decryptCurrentDocument = async (document: vscode.TextDocument): Promise<void> => {
  if (isVirtualDocument(document)) {
    showInfo('当前已经是解密编辑视图，保存时会自动加密写入磁盘。');
    return;
  }

  if (!isEncryptedText(document.getText())) {
    showInfo('当前文件不是加密格式。');
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
      showError('无法将明文写回原文件。');
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

    showInfo('已永久解密并保存，后续保存不会自动加密。');
    return;
  }

  if (!isEncryptedText(document.getText())) {
    showInfo('当前文件不在自动加密会话中，无需永久解密。');
    return;
  }

  const cachedPassword = passwordCache.get(sourceKey);
  const password = cachedPassword ?? (await promptPassword('请输入解密密码'));
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
    showError('无法将解密结果写入当前文档。');
    return;
  }

  const saved = await document.save();
  if (!saved) {
    showError('文件已解密，但自动保存失败，请手动保存。');
    return;
  }

  passwordCache.delete(sourceKey);
  decryptedSession.delete(sourceKey);
  skippedAutoDecrypt.delete(sourceKey);
  decryptPromptInProgress.delete(sourceKey);
  encryptedOnDiskState.set(sourceKey, false);

  showInfo('已永久解密并保存，后续保存不会自动加密。');
};

const runCommandForActiveDocument = async (
  mode: 'encrypt' | 'decrypt' | 'toggle' | 'permanentDecrypt',
): Promise<void> => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    showError('没有可操作的活动编辑器。');
    return;
  }

  const document = editor.document;
  if (document.uri.scheme !== 'file' && !isVirtualDocument(document)) {
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

  if (mode === 'permanentDecrypt') {
    await permanentlyDecryptCurrentDocument(document);
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

class EncryptedVirtualFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  public readonly onDidChangeFile = this.changeEmitter.event;

  public watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    return vscode.workspace.fs.stat(sourceUri);
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    return vscode.workspace.fs.readDirectory(sourceUri);
  }

  public async createDirectory(uri: vscode.Uri): Promise<void> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    await vscode.workspace.fs.createDirectory(sourceUri);
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    const sourceKey = getUriKey(sourceUri);
    const raw = await vscode.workspace.fs.readFile(sourceUri);
    const content = Buffer.from(raw).toString('utf8');

    const encrypted = isEncryptedText(content);
    encryptedOnDiskState.set(sourceKey, encrypted);

    if (!encrypted) {
      return raw;
    }

    const password = passwordCache.get(sourceKey);
    if (!password) {
      throw vscode.FileSystemError.NoPermissions('缺少密码，请先重新解密文件。');
    }

    try {
      const plainText = decryptText(content, password);
      return Buffer.from(plainText, 'utf8');
    } catch {
      passwordCache.delete(sourceKey);
      throw vscode.FileSystemError.NoPermissions('密码错误，请关闭后重新打开文件。');
    }
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: {
      readonly create: boolean;
      readonly overwrite: boolean;
    },
  ): Promise<void> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    const sourceKey = getUriKey(sourceUri);
    const password = passwordCache.get(sourceKey);

    if (!password) {
      throw vscode.FileSystemError.NoPermissions('缺少密码，无法保存。');
    }

    let sourceExists = true;
    try {
      await vscode.workspace.fs.stat(sourceUri);
    } catch {
      sourceExists = false;
    }

    if (!sourceExists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(sourceUri);
    }

    if (sourceExists && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(sourceUri);
    }

    const plainText = Buffer.from(content).toString('utf8');
    const encryptedContent = encryptText(plainText, password);

    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(encryptedContent, 'utf8'));
    encryptedOnDiskState.set(sourceKey, true);
    decryptedSession.add(sourceKey);

    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  public async delete(
    uri: vscode.Uri,
    options: {
      readonly recursive: boolean;
      readonly useTrash: boolean;
    },
  ): Promise<void> {
    const sourceUri = getRequiredSourceUriFromVirtualUri(uri);
    await vscode.workspace.fs.delete(sourceUri, options);
  }

  public async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: {
      readonly overwrite: boolean;
    },
  ): Promise<void> {
    const oldSourceUri = getRequiredSourceUriFromVirtualUri(oldUri);
    const newSourceUri = getRequiredSourceUriFromVirtualUri(newUri);
    await vscode.workspace.fs.rename(oldSourceUri, newSourceUri, options);
  }
}

const hasOpenDocumentForSource = (sourceUri: vscode.Uri): boolean => {
  const sourceUriKey = getUriKey(sourceUri);

  return vscode.workspace.textDocuments.some((document) => {
    return getSourceUriKey(document.uri) === sourceUriKey;
  });
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      VIRTUAL_DOCUMENT_SCHEME,
      new EncryptedVirtualFileSystemProvider(),
      { isCaseSensitive: true },
    ),
    vscode.commands.registerCommand('encrypted-notes.toggleEncryption', async () =>
      runCommandForActiveDocument('toggle'),
    ),
    vscode.commands.registerCommand('encrypted-notes.encryptCurrent', async () =>
      runCommandForActiveDocument('encrypt'),
    ),
    vscode.commands.registerCommand('encrypted-notes.decryptCurrent', async () =>
      runCommandForActiveDocument('decrypt'),
    ),
    vscode.commands.registerCommand('encrypted-notes.permanentDecryptCurrent', async () =>
      runCommandForActiveDocument('permanentDecrypt'),
    ),
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
        if (document.uri.scheme === VIRTUAL_DOCUMENT_SCHEME) {
          encryptedOnDiskState.set(sourceKey, true);
          decryptedSession.add(sourceKey);
          vscode.window.setStatusBarMessage('Encrypted Notes: 文件已按加密格式保存。', 1600);
        }

        if (vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()) {
          await updateEditorContext();
        }
      })();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const sourceUri = getSourceUri(document.uri);
      const sourceKey = getUriKey(sourceUri);

      if (!hasOpenDocumentForSource(sourceUri)) {
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
