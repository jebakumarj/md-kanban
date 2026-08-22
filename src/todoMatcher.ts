export interface TodoMatch {
  keyword: string;
  title: string;
}

export function getTodoMatch(line: string, keywords: string[]): TodoMatch | undefined {
  const keywordPattern = keywords.map(escapeRegExp).join('|');
  if (!keywordPattern) {
    return undefined;
  }

  const patterns = [
    `//\\s*(${keywordPattern})(?::|\\b)\\s*(.*)$`,
    `(?:^|\\s)(?:[#!%']|;+|--)\\s*(${keywordPattern})(?::|\\b)\\s*(.*)$`,
    `^\\s*REM\\s+(${keywordPattern})(?::|\\b)\\s*(.*)$`,
    `<!--\\s*(${keywordPattern})(?::|\\b)\\s*(.*?)\\s*-->`,
    `(?:/\\*+\\s*|^\\s*\\*\\s*)(${keywordPattern})(?::|\\b)\\s*(.*?)(?:\\s*\\*/\\s*)?$`,
  ];

  for (const pattern of patterns) {
    const match = line.match(new RegExp(pattern, 'i'));
    if (match) {
      return {
        keyword: match[1].toUpperCase(),
        title: match[2].trim(),
      };
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
