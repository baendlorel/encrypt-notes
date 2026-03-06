import vscode from 'vscode';
import { t } from '../i18n/index.js';

export namespace ve {
  export const Scheme = 'encrypted-notes-decrypted';

  export const getUriKey = (uri: vscode.Uri): string => uri.toString();
  export const getSourceUri = (uri: vscode.Uri): vscode.Uri => toSourceUri(uri) ?? uri;
  export const getSourceUriKey = (uri: vscode.Uri): string => getUriKey(getSourceUri(uri));
  export const isVirtualUri = (uri: vscode.Uri): boolean => uri.scheme === Scheme;

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

  export const toSourceUri = (uri: vscode.Uri): vscode.Uri | undefined => {
    if (uri.scheme !== Scheme || uri.query.length === 0) {
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
  export const toVirtualUri = (uri: vscode.Uri): vscode.Uri => {
    return uri.with({
      scheme: Scheme,
      path: getVirtualDisplayPath(uri),
      query: encodeURIComponent(uri.toString()),
      fragment: '',
    });
  };

  export const isVirtual = (document: vscode.TextDocument) => document.uri.scheme === Scheme;

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

  export const hasOpenVirtualTabForSource = (sourceUri: vscode.Uri): boolean => {
    const sourceUriKey = getUriKey(sourceUri);

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) {
          continue;
        }

        if (!isVirtualUri(tab.input.uri)) {
          continue;
        }

        if (getSourceUriKey(tab.input.uri) === sourceUriKey) {
          return true;
        }
      }
    }

    return false;
  };

  export const closeTabsForUri = async (uri: vscode.Uri): Promise<void> => {
    const uriKey = getUriKey(uri);
    const tabs: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && getUriKey(tab.input.uri) === uriKey) {
          tabs.push(tab);
        }
      }
    }

    if (tabs.length === 0) {
      return;
    }

    await vscode.window.tabGroups.close(tabs, true);
  };
}
