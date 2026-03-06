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
    this.fileExtensions = new Set(
      rawFileExtensions
        .map((v) => v.trim().toLowerCase())
        .map((v) => (v.startsWith('.') ? v : '.' + v))
        .filter(Boolean),
    );

    const rawActionButtonLocation = this.config.get<string>('actionButtonLocation');
    this.actionButtonLocation = Configs.justifyActionButtonLocation(rawActionButtonLocation);
  }

  /**
   * Whether the given file extension is supported by the current configuration.
   */
  supports(fileExtension: string): boolean;
  supports(uri: vscode.Uri): boolean;
  supports(args: string | vscode.Uri): boolean {
    if (typeof args !== 'string') {
      if (args.scheme !== 'file') {
        return false;
      }

      args = path.extname(args.fsPath).toLowerCase();
    }

    return this.fileExtensions.has(args);
  }

  get buttonOnFirstLine(): boolean {
    return this.actionButtonLocation === Configs.ActionButtonLocation.FirstLine;
  }

  get buttonOnEditorTitle(): boolean {
    return this.actionButtonLocation === Configs.ActionButtonLocation.EditorTitle;
  }
}

export const configs = new EncryptNotesConfiguration();
