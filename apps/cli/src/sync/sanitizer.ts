/**
 * Content sanitizer — removes tokens, secrets, and credentials before writing to files.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /Bearer [A-Za-z0-9\-._~+/]+=*/g,
  /[A-Za-z0-9+/]{40,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xoxb-[0-9]{10,}-[a-zA-Z0-9]{20,}/g,
  /glpat-[a-zA-Z0-9\-]{20,}/g,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
];

export function sanitizeContent(content: string): string {
  let result = content;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
