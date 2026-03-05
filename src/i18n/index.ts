import vscode from 'vscode';
import { zh } from './zh.js';
import { en } from './en.js';

const dict = vscode.env.language.toLowerCase().startsWith('en') ? en : zh;
export const t = (key: keyof typeof zh, ...args: any[]): string => {
  let raw = dict[key];
  for (let i = 0; i < args.length; i++) {
    const element = args[i];
    raw = raw.replaceAll('{{' + i + '}}', String(element));
  }
  return raw;
};
