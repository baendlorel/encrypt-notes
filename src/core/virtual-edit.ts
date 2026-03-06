import vscode from 'vscode';
import type { DecryptTextFn, EncryptTextFn, IsEncryptedTextFn } from './types.js';

import { t } from '../i18n/index.js';
import { Consts } from './consts.js';

const UTF8_BOM_BUFFER = Buffer.from([0xef, 0xbb, 0xbf]);

const hasUtf8Bom = (content: Uint8Array): boolean =>
  content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;

interface VirtualEditProviderDeps {
  passwordCache: Map<string, string>;
  encryptedOnDiskState: Map<string, boolean>;
  decryptedSession: Set<string>;
  decryptText: DecryptTextFn;
  encryptText: EncryptTextFn;
  isEncryptedText: IsEncryptedTextFn;
}

const getRequiredSourceUriFromVirtualUri = (uri: vscode.Uri): vscode.Uri => {
  const sourceUri = parseSourceUriFromVirtualUri(uri);
  if (!sourceUri) {
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  return sourceUri;
};

export const getUriKey = (uri: vscode.Uri): string => uri.toString();

export const getVirtualDisplayPath = (sourceUri: vscode.Uri): string => {
  const sourcePath = sourceUri.path;
  const lastSlash = sourcePath.lastIndexOf('/');
  const directoryPath = lastSlash >= 0 ? sourcePath.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath;

  if (filename.length === 0) {
    return sourcePath;
  }

  return `${directoryPath}${t('virtual.displayPrefixDecrypted')}${filename}`;
};

export const parseSourceUriFromVirtualUri = (uri: vscode.Uri): vscode.Uri | undefined => {
  if (uri.scheme !== Consts.VDocScheme || uri.query.length === 0) {
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

export const getSourceUri = (uri: vscode.Uri): vscode.Uri => parseSourceUriFromVirtualUri(uri) ?? uri;

export const getSourceUriKey = (uri: vscode.Uri): string => getUriKey(getSourceUri(uri));

export const toVirtualUri = (sourceUri: vscode.Uri): vscode.Uri => {
  return sourceUri.with({
    scheme: Consts.VDocScheme,
    path: getVirtualDisplayPath(sourceUri),
    query: encodeURIComponent(sourceUri.toString()),
    fragment: '',
  });
};

export const isVirtualDocument = (document: vscode.TextDocument): boolean => {
  return document.uri.scheme === Consts.VDocScheme;
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

export const closeTabsForUri = async (uri: vscode.Uri): Promise<void> => {
  const tabs = getTabsForUri(uri);
  if (tabs.length === 0) {
    return;
  }

  await vscode.window.tabGroups.close(tabs, true);
};

export const hasOpenTabForSource = (sourceUri: vscode.Uri): boolean => {
  const sourceUriKey = getUriKey(sourceUri);

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) {
        continue;
      }

      if (getSourceUriKey(tab.input.uri) === sourceUriKey) {
        return true;
      }
    }
  }

  return false;
};

export class EncryptedVirtualFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  private readonly passwordCache: Map<string, string>;
  private readonly encryptedOnDiskState: Map<string, boolean>;
  private readonly decryptedSession: Set<string>;
  private readonly decryptText: DecryptTextFn;
  private readonly encryptText: EncryptTextFn;
  private readonly isEncryptedText: IsEncryptedTextFn;

  public constructor(deps: VirtualEditProviderDeps) {
    this.passwordCache = deps.passwordCache;
    this.encryptedOnDiskState = deps.encryptedOnDiskState;
    this.decryptedSession = deps.decryptedSession;
    this.decryptText = deps.decryptText;
    this.encryptText = deps.encryptText;
    this.isEncryptedText = deps.isEncryptedText;
  }

  public readonly onDidChangeFile = this.changeEmitter.event;

  public watch(
    _uri: vscode.Uri,
    _options: { readonly recursive: boolean; readonly excludes: readonly string[] },
  ): vscode.Disposable {
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

    const encrypted = this.isEncryptedText(content);
    this.encryptedOnDiskState.set(sourceKey, encrypted);

    if (!encrypted) {
      return raw;
    }

    const password = this.passwordCache.get(sourceKey);
    if (!password) {
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.readMissingPassword'));
    }

    try {
      const plainText = this.decryptText(content, password);
      return Buffer.from(plainText, 'utf8');
    } catch {
      this.passwordCache.delete(sourceKey);
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.readInvalidPassword'));
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
    const password = this.passwordCache.get(sourceKey);

    if (!password) {
      throw vscode.FileSystemError.NoPermissions(t('virtual.error.writeMissingPassword'));
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
    const encryptedContent = this.encryptText(plainText, password);
    const encryptedRaw = Buffer.from(encryptedContent, 'utf8');
    let nextRaw = encryptedRaw;

    if (sourceExists) {
      try {
        const sourceRaw = await vscode.workspace.fs.readFile(sourceUri);
        if (hasUtf8Bom(sourceRaw)) {
          nextRaw = Buffer.concat([UTF8_BOM_BUFFER, encryptedRaw]);
        }
      } catch {}
    }

    await vscode.workspace.fs.writeFile(sourceUri, nextRaw);
    this.encryptedOnDiskState.set(sourceKey, true);
    this.decryptedSession.add(sourceKey);

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
