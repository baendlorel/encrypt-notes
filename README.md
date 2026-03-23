# Secret Notes

A VS Code extension for keeping local text notes encrypted on disk while editing them in a temporary decrypted view.

[简体中文](./README.zh-cn.md)

<img src="/assets/encrypt.gif">

## How it works

- Works with local files only.
- Manages configurable file extensions; defaults: `.txt`, `.md`.
- `Encrypt Current File` encrypts the active plaintext file, saves it, then opens a decrypted virtual editor for continued editing.
- When an encrypted file becomes active, the extension asks for a password and opens the decrypted virtual editor.
- Saving the decrypted virtual editor writes encrypted content back to the original file.
- `Permanently Decrypt Current File` writes plaintext back to disk and ends the auto-encrypted editing session.
- Action buttons can appear on the first line (CodeLens, default) or in the editor title.

## Encrypted file format

```text
ENCRYPTED_FILE
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"...","iv":"...","tag":"..."}
<base64 ciphertext>
```

- Algorithm: `AES-256-GCM`
- KDF: `PBKDF2-SHA256`
- PBKDF2 iterations: `210000`

## Commands

- `Secret Notes: Encrypt Current File` (`secret-notes.encrypt`)
- `Secret Notes: Permanently Decrypt Current File` (`secret-notes.decrypt`)

> The UI `Permanent Decrypt` button / CodeLens runs the permanent decrypt command. Temporary decrypted editing is opened automatically after password entry.

## Settings

```jsonc
{
  "secret-notes.fileExtensions": ["txt", "md"],
  "secret-notes.exclude": ["**/node_modules/**", "**/dist/**"],
  "secret-notes.passwordKeepMinute": 5,
}
```

- `fileExtensions`: accepts values with or without leading dots.
- `exclude`: glob patterns for folders or files that should be ignored. The default list includes common generated or vendor folders such as `node_modules`, `dist`, `out`, `build`, `coverage`, `.git`, `.next`, and `.turbo`.
- `passwordKeepMinute`: password cache time in memory. `0` effectively clears the password immediately after it is set.

## Limitations

- Intended for UTF-8 text files.
- Only local files are supported.
- Passwords are cached in memory only and are not persisted across VS Code restarts.

## Lisense

MIT License
