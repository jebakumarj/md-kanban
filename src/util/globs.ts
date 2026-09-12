/**
 * Glob and string helpers with no VS Code dependency, so they stay unit testable.
 */

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globMatches(value: string, glob: string): boolean {
  const pattern = glob.trim();
  if (!pattern) {
    return false;
  }

  const regex = new RegExp(
    '^' + escapeRegExp(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$',
    'i'
  );
  return regex.test(value);
}

export function combineGlobPatterns(patterns: string[]): string | undefined {
  const cleaned = uniqueStrings(patterns.map(pattern => pattern.trim()).filter(Boolean));
  if (cleaned.length === 0) {
    return undefined;
  }

  if (cleaned.length === 1) {
    return cleaned[0];
  }

  return `{${cleaned.join(',')}}`;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
