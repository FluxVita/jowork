import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive a 256-bit key from the master secret using scrypt.
 * Salt is stored with the ciphertext so each encryption gets a unique key.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

function getMasterSecret(): string {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret || secret === 'dev-secret-change-me') {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY (or JWT_SECRET) must be set for credential encryption');
  }
  return secret;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output format: base64(salt + iv + tag + ciphertext)
 */
export function encryptCredential(plaintext: string): string {
  const secret = getMasterSecret();
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // salt(16) + iv(12) + tag(16) + ciphertext
  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypt AES-256-GCM ciphertext.
 */
export function decryptCredential(ciphertext: string): string {
  const secret = getMasterSecret();
  const buf = Buffer.from(ciphertext, 'base64');

  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf-8');
}
