import path from 'node:path';
import { minimatch } from 'minimatch';
import vscode from 'vscode';
import { Configs, Consts } from './consts.js';

class SecretNotesConfiguration {
  private config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(Consts.ExtensionId);

  private fileExtensions: Set<string> = new Set();
  private exclude: string[] = [];
  private buttonLocation: Configs.ButtonLocation = Configs.DefaultButtonLocation;

  passwordKeepTime = Configs.DefaultPasswordKeepMinute * 60 * 1000;

  update() {
    this.config = vscode.workspace.getConfiguration(Consts.ExtensionId);

    const rawFileExtensions = this.config.get<string[]>('fileExtensions', Configs.DefaultFileExtensions);
    this.fileExtensions = new Set(
      rawFileExtensions
        .map((v) => v.trim().toLowerCase())
        .map((v) => (v.startsWith('.') ? v : '.' + v))
        .filter(Boolean),
    );

    const rawExclude = this.config.get<string[]>('exclude', Configs.DefaultExclude);
    this.exclude = rawExclude.map((v) => v.trim()).filter(Boolean);

    const rawActionButtonLocation = this.config.get<string>('actionButtonLocation');
    this.buttonLocation = Configs.justifyButtonLocation(rawActionButtonLocation);

    const rawPasswordKeepTime =
      this.config.get<number>('passwordKeepMinute', Configs.DefaultPasswordKeepMinute) * 60 * 1000;
    this.passwordKeepTime = Number.isFinite(rawPasswordKeepTime)
      ? Math.max(0, Math.floor(rawPasswordKeepTime))
      : Configs.DefaultPasswordKeepMinute * 60 * 1000;
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

      return this.fileExtensions.has(path.extname(args.fsPath).toLowerCase()) && !this.isExcluded(args);
    }

    return this.fileExtensions.has(args);
  }

  private isExcluded(uri: vscode.Uri): boolean {
    const normalizedPath = uri.fsPath.split(path.sep).join('/');
    return this.exclude.some((pattern) =>
      minimatch(normalizedPath, pattern, { dot: true, nocase: process.platform === 'win32' }),
    );
  }

  /**
   * If `true`, show the code lens action buttons.
   */
  get buttonOnFirstLine(): boolean {
    return this.buttonLocation === Configs.ButtonLocation.FirstLine;
  }

  /**
   * If `true`, show action buttons on the editor title.
   */
  get buttonOnEditorTitle(): boolean {
    return this.buttonLocation === Configs.ButtonLocation.EditorTitle;
  }
}

export const configs = new SecretNotesConfiguration();
