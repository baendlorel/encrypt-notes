import vscode from 'vscode';
import { t } from '@/i18n/index.js';

export namespace ve {
  export const Scheme = 'encrypted-notes-decrypted';

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
}
