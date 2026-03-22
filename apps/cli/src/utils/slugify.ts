/**
 * File-safe slug function that preserves CJK characters.
 * Removes filesystem-unsafe characters while keeping unicode letters.
 */
export function slugify(name: string): string {
  return (
    name
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'untitled'
  );
}
