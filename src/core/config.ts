import path from 'node:path';
import vscode from 'vscode';
import { Configs, Consts } from './consts.js';

class EncryptNotesConfiguration {
  private config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(Consts.ExtensionId);

  private fileExtensions: Set<string> = new Set();
  private buttonLocation: Configs.ButtonLocation = Configs.DefaultButtonLocation;

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
    this.buttonLocation = Configs.justifyButtonLocation(rawActionButtonLocation);
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
    return this.buttonLocation === Configs.ButtonLocation.FirstLine;
  }

  get buttonOnEditorTitle(): boolean {
    return this.buttonLocation === Configs.ButtonLocation.EditorTitle;
  }
}

export const configs = new EncryptNotesConfiguration();
