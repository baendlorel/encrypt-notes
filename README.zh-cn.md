# Secret Notes

一个 VS Code 扩展：让本地文本笔记以加密形式落盘，并在临时明文视图中继续编辑。

[English](./README.md)

<img src="/assets/encrypt.gif">

## 实际工作方式

- 仅支持本地文件。
- 处理的文件扩展名可配置，默认是 `.txt`、`.md`。
- `加密当前文件` 会把当前明文文件加密并保存，然后自动打开一个明文虚拟编辑视图继续编辑。
- 当加密文件成为当前活动文件时，扩展会要求输入密码，并打开明文虚拟编辑视图。
- 在明文虚拟编辑视图中保存时，写回磁盘的仍然是加密内容。
- `永久解密当前文件` 会把源文件真正改回明文，并结束这次自动加密编辑会话。
- 操作按钮可显示在首行 CodeLens（默认）或编辑器右上角。

## 加密文件格式

```text
ENCRYPTED_FILE
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"...","iv":"...","tag":"..."}
<base64 密文>
```

- 算法：`AES-256-GCM`
- 密钥派生：`PBKDF2-SHA256`
- PBKDF2 迭代次数：`210000`

## 命令

- `秘密笔记: 加密当前文件`（`secret-notes.encrypt`）
- `秘密笔记: 永久解密当前文件`（`secret-notes.decrypt`）

> 界面里的 `永久解密` 按钮 / CodeLens 实际执行的是“永久解密当前文件”。临时明文编辑视图是在输入密码后自动打开的。

## 配置

```jsonc
{
  "secret-notes.fileExtensions": ["txt", "md"],
  "secret-notes.exclude": ["**/node_modules/**", "**/dist/**"],
  "secret-notes.passwordKeepMinute": 5,
}
```

- `fileExtensions`：带不带前导点都可以。
- `exclude`：用于忽略文件或目录的 glob 模式。默认会忽略 `node_modules`、`dist`、`out`、`build`、`coverage`、`.git`、`.next`、`.turbo` 这些常见目录。
- `passwordKeepMinute`：密码在内存中的缓存时间。设为 `0` 时，效果等同于刚设置就立即清空。

## 限制

- 适合 UTF-8 文本文件。
- 仅支持本地文件。
- 密码只缓存在扩展进程内存中，重启 VS Code 后不会保留。

## Lisense

MIT License
