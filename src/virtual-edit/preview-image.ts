import path from 'node:path';
import * as vscode from 'vscode';
import { ve } from './methods.js';

interface ImageSpec {
  line: number;
  src: string;
  width?: string;
  height?: string;
}

const htmlImageTagPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
const markdownImagePattern = /!\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const urlSchemePattern = /^[a-z][a-z\d+\-.]*:/i;
const windowsDrivePattern = /^[a-z]:[\\/]/i;

const normalizeCssSize = (rawSize: string | undefined): string | undefined => {
  if (!rawSize) {
    return undefined;
  }

  const normalized = rawSize.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return `${normalized}px`;
  }

  if (/^\d+(\.\d+)?(px|em|rem|vh|vw|%)$/i.test(normalized)) {
    return normalized;
  }

  return undefined;
};

const getTagAttribute = (tag: string, name: 'width' | 'height'): string | undefined => {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
};

const parseImageSpecsFromLine = (lineText: string, line: number): ImageSpec[] => {
  const specs: ImageSpec[] = [];

  for (const match of lineText.matchAll(htmlImageTagPattern)) {
    const tag = match[0];
    const src = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!src) {
      continue;
    }

    specs.push({
      line,
      src,
      width: normalizeCssSize(getTagAttribute(tag, 'width')),
      height: normalizeCssSize(getTagAttribute(tag, 'height')),
    });
  }

  for (const match of lineText.matchAll(markdownImagePattern)) {
    const matchedSrc = (match[1] ?? '').trim();
    const src =
      matchedSrc.startsWith('<') && matchedSrc.endsWith('>')
        ? matchedSrc.slice(1, -1).trim()
        : matchedSrc;

    if (!src) {
      continue;
    }

    specs.push({
      line,
      src,
    });
  }

  return specs;
};

const resolveImageUri = (document: vscode.TextDocument, src: string): vscode.Uri | undefined => {
  const normalizedSrc = src.trim();
  if (!normalizedSrc) {
    return undefined;
  }

  try {
    if (normalizedSrc.startsWith('//')) {
      return vscode.Uri.parse(`https:${normalizedSrc}`, true);
    }

    if (urlSchemePattern.test(normalizedSrc)) {
      return vscode.Uri.parse(normalizedSrc, true);
    }
  } catch {
    return undefined;
  }

  const sourceUri = ve.getSourceUri(document.uri);

  if (sourceUri.scheme === 'file') {
    if (windowsDrivePattern.test(normalizedSrc)) {
      return vscode.Uri.file(normalizedSrc);
    }

    if (normalizedSrc.startsWith('/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
      if (workspaceFolder) {
        return vscode.Uri.joinPath(workspaceFolder.uri, normalizedSrc.slice(1));
      }

      return vscode.Uri.file(normalizedSrc);
    }

    const resolvedPath = path.resolve(path.dirname(sourceUri.fsPath), normalizedSrc);
    return vscode.Uri.file(resolvedPath);
  }

  try {
    return vscode.Uri.joinPath(sourceUri, normalizedSrc);
  } catch {
    return undefined;
  }
};

const shouldPreview = (document: vscode.TextDocument): boolean => {
  if (!ve.isVirtual(document)) {
    return false;
  }

  const sourceUri = ve.getSourceUri(document.uri);
  if (sourceUri.scheme !== 'file') {
    return false;
  }

  const extension = path.extname(sourceUri.fsPath).toLowerCase();
  return document.languageId === 'markdown' || extension === '.md' || extension === '.markdown';
};

const buildImageSpecs = (document: vscode.TextDocument): ImageSpec[] => {
  const specs: ImageSpec[] = [];

  for (let line = 0; line < document.lineCount; line++) {
    const lineText = document.lineAt(line).text;
    specs.push(...parseImageSpecsFromLine(lineText, line));
  }

  return specs;
};

const createAttachment = (
  imageUri: vscode.Uri,
  width?: string,
  height?: string,
): vscode.ThemableDecorationAttachmentRenderOptions => {
  const attachment: vscode.ThemableDecorationAttachmentRenderOptions = {
    contentIconPath: imageUri,
    textDecoration: 'none; display: block;',
    margin: '0.45em 0 0.8em 0;',
  };

  if (width) {
    attachment.width = width;
  }

  if (height) {
    attachment.height = height;
  }

  return attachment;
};

export class MarkdownImagePreview implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationTypes: vscode.TextEditorDecorationType[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  public constructor() {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (vscode.window.activeTextEditor?.document.uri.toString() !== event.document.uri.toString()) {
          return;
        }

        this.scheduleRefresh();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString()) {
          return;
        }

        this.scheduleRefresh();
      }),
    );

    this.scheduleRefresh();
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.clearDecorations();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refreshActiveEditor();
    }, 120);
  }

  private refreshActiveEditor(): void {
    this.clearDecorations();

    const editor = vscode.window.activeTextEditor;
    if (!editor || !shouldPreview(editor.document)) {
      return;
    }

    for (const imageSpec of buildImageSpecs(editor.document)) {
      const imageUri = resolveImageUri(editor.document, imageSpec.src);
      if (!imageUri) {
        continue;
      }

      const lineRange = editor.document.lineAt(imageSpec.line).range;
      const decorationType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        after: createAttachment(imageUri, imageSpec.width, imageSpec.height),
      });

      this.decorationTypes.push(decorationType);
      editor.setDecorations(decorationType, [lineRange]);
    }
  }

  private clearDecorations(): void {
    for (const decorationType of this.decorationTypes) {
      decorationType.dispose();
    }

    this.decorationTypes.length = 0;
  }
}
