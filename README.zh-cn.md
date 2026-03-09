# Encrypted Notes

一个用于 VS Code 的文本文件加密/解密插件。

## 功能

- 在编辑器右上角（标题栏）提供锁/解锁按钮。
- 在文件首行的 CodeLens 提供条件显示的“加密 / 解密”按钮。
- 支持加密当前文件，并对已解密会话执行永久解密。
- 对已解密会话提供“永久解密”按钮，可直接保存为明文文件。
- 打开加密文件时自动弹窗输入密码。
- 已解密内容在保存时会自动重新加密。
- 支持配置可处理的文件扩展名（默认：`txt`、`md`）。
- 支持配置密码缓存时间。

## 加密文件格式（v1）

```text
ENCRYPTED_FILE
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"...","iv":"...","tag":"..."}
<base64 密文>
```

- 算法：`AES-256-GCM`
- 密钥派生：`PBKDF2-HMAC-SHA256`

## 设置项

```json
{
  "encrypted-notes.fileExtensions": ["txt", "md"],
  "encrypted-notes.actionButtonLocation": "首行",
  "encrypted-notes.passwordKeepMinute": 5
}
```

## 命令

- `加密笔记: 加密当前文件`
- `加密笔记: 永久解密当前文件`

## 开发

```bash
pnpm install
pnpm check
pnpm build
```

在 VS Code 中按 `F5` 启动 Extension Development Host 调试。
