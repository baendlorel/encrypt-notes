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
    this.fileExtensions = new Set(rawFileExtensions.map((v) => v.trim().toLowerCase()).filter(Boolean));

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

export const isSupportedByUri = (uri: vscode.Uri): boolean => {
  if (uri.scheme !== 'file') {
    return false;
  }
  return configs.supports(path.extname(uri.fsPath));
};
