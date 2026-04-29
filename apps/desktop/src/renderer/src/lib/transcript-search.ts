export type TextRange = {
  end: number;
  start: number;
};

export function buildHighlightedTextSlices(text: string, query: string): Array<TextRange & { text: string; search: boolean }> {
  const ranges = findSearchRanges(text, query);
  if (ranges.length === 0) {
    return [{ start: 0, end: text.length, text, search: false }];
  }

  const slices: Array<TextRange & { text: string; search: boolean }> = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      slices.push({ start: cursor, end: range.start, text: text.slice(cursor, range.start), search: false });
    }

    slices.push({ ...range, text: text.slice(range.start, range.end), search: true });
    cursor = range.end;
  }

  if (cursor < text.length) {
    slices.push({ start: cursor, end: text.length, text: text.slice(cursor), search: false });
  }

  return slices;
}

export function findSearchRanges(text: string, query: string): TextRange[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const ranges: TextRange[] = [];
  const matcher = new RegExp(escapeRegExp(normalizedQuery), 'gi');
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });

    if (match[0].length === 0) {
      matcher.lastIndex += 1;
    }
  }

  return ranges;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countTranscriptMatches<TSegment extends { text: string }>(segments: TSegment[], query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  return segments.reduce((count, segment) => count + (segment.text.toLowerCase().includes(normalizedQuery) ? 1 : 0), 0);
}

export function findTranscriptMatchIndexes<TSegment extends { text: string }>(segments: TSegment[], query: string): number[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return segments.reduce<number[]>((indexes, segment, index) => {
    if (segment.text.toLowerCase().includes(normalizedQuery)) {
      indexes.push(index);
    }
    return indexes;
  }, []);
}
