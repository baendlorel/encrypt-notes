import path from 'node:path';
import vscode from 'vscode';
import { Configs, Consts } from './consts.js';

class EncryptNotesConfiguration {
  private config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(Consts.ExtensionId);

  private fileExtensions: Set<string> = new Set();
  private actionButtonLocation: Configs.ActionButtonLocation = Configs.DefaultActionButtonLocation;

  update() {
    this.config = vscode.workspace.getConfiguration(Consts.ExtensionId);

    const rawFileExtensions = this.config.get<string[]>('fileExtensions', Configs.DefaultFileExtensions);
    this.fileExtensions = new Set(rawFileExtensions.map(normalizeFileExt).filter(Boolean));

    const rawActionButtonLocation = this.config.get<string>('actionButtonLocation');
    this.actionButtonLocation = Configs.justifyActionButtonLocation(rawActionButtonLocation);
  }

  /**
   * Whether the given file extension is supported by the current configuration.
   */
  supports(fileExtension: string): boolean {
    return this.fileExtensions.has(fileExtension);
  }

  get buttonOnFirstLine(): boolean {
    return this.actionButtonLocation === Configs.ActionButtonLocation.FirstLine;
  }

  get buttonOnEditorTitle(): boolean {
    return this.actionButtonLocation === Configs.ActionButtonLocation.EditorTitle;
  }
}

export const configs = new EncryptNotesConfiguration();

export const normalizeFileExt = (value: string): string => value.trim().toLowerCase().replace(/^\./, '');

export const getDocumentExtension = (document: vscode.TextDocument): string => {
  return getUriExtension(document.uri);
};

export const getUriExtension = (uri: vscode.Uri): string => {
  if (uri.scheme !== 'file') {
    return '';
  }

  const extension = path.extname(uri.fsPath);
  return normalizeFileExt(extension);
};

export const isSupportedByUriExtensionList = (uri: vscode.Uri): boolean => {
  if (uri.scheme !== 'file') {
    return false;
  }

  const extension = getUriExtension(uri);
  if (extension.length === 0) {
    return false;
  }

  return configs.supports(extension);
};

export const isSupportedByExtensionList = (document: vscode.TextDocument): boolean => {
  return isSupportedByUriExtensionList(document.uri);
};
