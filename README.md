# Encrypted Notes

Encrypt and decrypt text files in VS Code.

## Features

- Adds lock/unlock buttons to the editor title area (top-right).
- Adds conditional `Encrypt / Decrypt` CodeLens actions at the first line.
- Supports encrypting the current file and permanently decrypting decrypted sessions.
- Provides a permanent decrypt action for decrypted sessions to save plaintext directly.
- Automatically prompts for password when opening encrypted files.
- Automatically encrypts decrypted content again when you save.
- Configurable file extension list (default: `txt`, `md`).
- Configurable password cache time.

## Encryption Format (v1)

Encrypted files are stored as:

```text
ENCRYPTED_FILE
{"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":210000,"salt":"...","iv":"...","tag":"..."}
<base64 ciphertext>
```

- Algorithm: `AES-256-GCM`
- KDF: `PBKDF2-HMAC-SHA256`

## Settings

```json
{
  "encrypted-notes.fileExtensions": ["txt", "md"],
  "encrypted-notes.actionButtonLocation": "Fisrt Line",
  "encrypted-notes.passwordKeepMinute": 5
}
```

## Commands

- `Encrypted Notes: Encrypt Current File`
- `Encrypted Notes: Permanently Decrypt Current File`

## Development

```bash
pnpm install
pnpm check
pnpm build
```

Press `F5` in VS Code to launch Extension Development Host.
