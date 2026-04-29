export function parseWhisperProgressLine(line: string): number | null {
  const match = /progress\s*=\s*(?<percent>\d{1,3}(?:\.\d+)?)\s*%/i.exec(line);
  if (!match?.groups?.percent) {
    return null;
  }

  const value = Number(match.groups.percent);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value / 100));
}
