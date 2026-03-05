# Encrypted Notes

Encrypt and decrypt text files in VS Code.

## Features

- Adds lock/unlock buttons to the editor title area (top-right).
- Adds conditional `Encrypt / Decrypt` CodeLens actions at the first line.
- Supports manual encrypt/decrypt for current file.
- Provides a permanent decrypt action for decrypted sessions to save plaintext directly.
- Automatically prompts for password when opening encrypted files.
- Automatically encrypts decrypted content again when you save.
- Lets you choose whether plaintext should be restored after save (helps avoid always-dirty markers).
- Configurable file extension list (default includes `txt`, `md`, `json`, `yaml`, ...).

## Encryption Format (v1)

Encrypted files are stored as:

```text
#__ENCRYPTED_FILE__#
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"...","iv":"...","tag":"..."}
<base64 ciphertext>
```

- Algorithm: `AES-256-GCM`
- KDF: `PBKDF2-HMAC-SHA256`

## Settings

```json
{
  "encrypted-notes.enabled": true,
  "encrypted-notes.fileExtensions": ["txt", "md", "markdown", "json", "yaml", "yml", "ini", "log", "csv"],
  "encrypted-notes.restorePlainTextAfterSave": true
}
```

## Commands

- `Encrypted Notes: Toggle Encrypt/Decrypt`
- `Encrypted Notes: Encrypt Current File`
- `Encrypted Notes: Decrypt Current File`
- `Encrypted Notes: Permanently Decrypt Current File`

## Development

```bash
pnpm install
pnpm check
pnpm build
```

Press `F5` in VS Code to launch Extension Development Host.
