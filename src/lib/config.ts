import path from 'node:path';
import vscode from 'vscode';
import type { ActionButtonLocation } from './types.js';
import { Defaults, Consts } from './consts.js';

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly fileExtensions: ReadonlySet<string>;
  readonly actionButtonLocation: ActionButtonLocation;
}

export const normalizeFileExtension = (value: string): string => value.trim().toLowerCase().replace(/^\./, '');

export const getExtensionConfig = (): ExtensionConfig => {
  const config = vscode.workspace.getConfiguration(Consts.ExtensionId);
  const enabled = config.get<boolean>('enabled', true);
  const configured = config.get<string[]>('fileExtensions', Defaults.FileExtensions);

  const configuredActionButtonLocation = config.get<string>('actionButtonLocation', Defaults.ActionButtonLocation);
  const actionButtonLocation = Defaults.isActionButtonLocation(configuredActionButtonLocation)
    ? configuredActionButtonLocation
    : Defaults.ActionButtonLocation;

  const normalized = configured.map(normalizeFileExtension).filter((value) => value.length > 0);

  return {
    enabled,
    fileExtensions: new Set(normalized),
    actionButtonLocation,
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
