import path from 'node:path';
import * as vscode from 'vscode';

export const EXTENSION_ID = 'encrypted-notes';

const DEFAULT_FILE_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'ini', 'log', 'csv'];

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly fileExtensions: ReadonlySet<string>;
  readonly restorePlainTextAfterSave: boolean;
}

export const normalizeFileExtension = (value: string): string => value.trim().toLowerCase().replace(/^\./, '');

export const getExtensionConfig = (): ExtensionConfig => {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  const enabled = config.get<boolean>('enabled', true);
  const configured = config.get<string[]>('fileExtensions', DEFAULT_FILE_EXTENSIONS);
  const restorePlainTextAfterSave = config.get<boolean>('restorePlainTextAfterSave', true);
  const normalized = configured
    .map(normalizeFileExtension)
    .filter((value) => value.length > 0);

  return {
    enabled,
    fileExtensions: new Set(normalized),
    restorePlainTextAfterSave,
  };
};

export const getDocumentExtension = (document: vscode.TextDocument): string => {
  return getUriExtension(document.uri);
};

export const getUriExtension = (uri: vscode.Uri): string => {
  if (uri.scheme !== 'file') {
    return '';
  }

  const extension = path.extname(uri.fsPath);
  return normalizeFileExtension(extension);
};

export const isSupportedByUriExtensionList = (uri: vscode.Uri): boolean => {
  if (uri.scheme !== 'file') {
    return false;
  }

  const extension = getUriExtension(uri);
  if (extension.length === 0) {
    return false;
  }

  return getExtensionConfig().fileExtensions.has(extension);
};

export const isSupportedByExtensionList = (document: vscode.TextDocument): boolean => {
  return isSupportedByUriExtensionList(document.uri);
};
