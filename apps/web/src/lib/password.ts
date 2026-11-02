const utf8 = new TextEncoder();

/** The core refuses more than 72 UTF-8 bytes: bcrypt reads no further. */
export const passwordTooLong = (password: string) => utf8.encode(password).length > 72;
