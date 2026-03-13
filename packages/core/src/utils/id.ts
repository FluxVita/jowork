import { customAlphabet } from 'nanoid';

// Exclude '_' from the alphabet since '_' is used as the prefix separator
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-';
const generate = customAlphabet(alphabet, 12);

export const createId = (prefix?: string): string =>
  prefix ? `${prefix}_${generate()}` : generate();
