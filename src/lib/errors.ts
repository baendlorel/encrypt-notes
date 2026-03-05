export class InvalidEncryptedFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidEncryptedFileError';
  }
}

export class InvalidPasswordError extends Error {
  public constructor(message = 'Invalid password.') {
    super(message);
    this.name = 'InvalidPasswordError';
  }
}
