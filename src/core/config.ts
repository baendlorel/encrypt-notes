import path from 'node:path';
import vscode from 'vscode';
import { Configs, Consts } from './consts.js';

class SecretNotesConfiguration {
  private config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(Consts.ExtensionId);

  private fileExtensions: Set<string> = new Set();
  private exclude: string[] = [];

  debug = false;
  passwordKeepTime = Configs.DefaultPasswordKeepMinute * 60 * 1000;

  update() {
    this.config = vscode.workspace.getConfiguration(Consts.ExtensionId);

    const rawFileExts = this.config.get<string[]>('fileExtensions', Configs.DefaultFileExts);
    this.fileExtensions = new Set(
      rawFileExts
        .map((v) => v.trim().toLowerCase())
        .map((v) => (v.startsWith('.') ? v : '.' + v))
        .filter(Boolean),
    );

    const rawExclude = this.config.get<string[]>('exclude', Configs.DefaultExclude);
    this.exclude = rawExclude.map((v) => v.trim()).filter(Boolean);

    this.debug = this.config.get<boolean>('debug', false);

    const rawPasswordKeepTime =
      this.config.get<number>('passwordKeepMinute', Configs.DefaultPasswordKeepMinute) * 60 * 1000;
    this.passwordKeepTime = Number.isFinite(rawPasswordKeepTime)
      ? Math.max(0, Math.floor(rawPasswordKeepTime))
      : Configs.DefaultPasswordKeepMinute * 60 * 1000;
  }

  /**
   * Whether the given file extension is supported by the current configuration.
   */
  supports(document: vscode.TextDocument): boolean;
  supports(fileExtension: string): boolean;
  supports(uri: vscode.Uri): boolean;
  supports(arg: string | vscode.Uri | vscode.TextDocument): boolean {
    if (typeof arg === 'string') {
      return this.fileExtensions.has(arg);
    }

    const uri = arg instanceof vscode.Uri ? arg : arg.uri;
    if (uri.scheme !== 'file') {
      return false;
    }
    return this.fileExtensions.has(path.extname(uri.fsPath).toLowerCase()) && !this.isExcluded(uri);
  }

  isExcluded(uri: vscode.Uri): boolean {
    const normalizedPath = uri.fsPath.split(path.sep).join('/');
    return this.exclude.some((pattern) => normalizedPath.includes(pattern));
  }
}

export const configs = new SecretNotesConfiguration();
