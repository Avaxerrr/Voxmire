import { existsSync, readFileSync } from 'node:fs';
import type { TranscriptSegment, TranscriptWordTiming } from '@voxmire/contracts';

type WhisperJsonSegment = {
  text?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  words?: WhisperJsonWord[];
  tokens?: WhisperJsonToken[];
};

type WhisperJsonWord = {
  text?: string;
  word?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  start?: number;
  end?: number;
};

type WhisperJsonToken = {
  text?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  t0?: number;
  t1?: number;
};

export function readWhisperJsonSegments(jsonPath: string, jobId: string): TranscriptSegment[] {
  if (!existsSync(jsonPath)) {
    return [];
  }

  return parseWhisperJsonSegmentsPayload(JSON.parse(readFileSync(jsonPath, 'utf8')), jobId);
}

export function parseWhisperJsonSegmentsPayload(payload: unknown, jobId: string): TranscriptSegment[] {
  const parsed = payload as { transcription?: WhisperJsonSegment[] };
  return (parsed.transcription ?? []).map((segment, index) => {
    const wordTimings = parseWhisperWordTimings(segment);
    return {
      id: `seg_${crypto.randomUUID()}`,
      jobId,
      index,
      startSeconds: offsetToSeconds(segment.offsets?.from, segment.timestamps?.from),
      endSeconds: offsetToSeconds(segment.offsets?.to, segment.timestamps?.to),
      text: segment.text?.trim() ?? '',
      wordTimings,
      alignmentStatus: wordTimings.length > 0 ? 'aligned' : 'none',
      confidence: null,
      createdAt: new Date().toISOString()
    };
  });
}

function parseWhisperWordTimings(segment: WhisperJsonSegment): TranscriptWordTiming[] {
  if (segment.words && segment.words.length > 0) {
    return segment.words.flatMap(parseWhisperWordTiming).filter(isUsableWordTiming);
  }

  if (segment.tokens && segment.tokens.length > 0) {
    return parseWordTimingsFromTokens(segment.tokens);
  }

  return [];
}

function parseWhisperWordTiming(word: WhisperJsonWord): TranscriptWordTiming[] {
  const text = normalizeWhisperWordText(word.word ?? word.text ?? '');
  if (!text) {
    return [];
  }

  const startSeconds = secondsFromMixedTiming(word.offsets?.from, word.timestamps?.from, word.start);
  const endSeconds = secondsFromMixedTiming(word.offsets?.to, word.timestamps?.to, word.end);

  return [{ text, startSeconds, endSeconds }];
}

function parseWordTimingsFromTokens(tokens: WhisperJsonToken[]): TranscriptWordTiming[] {
  const wordTimings: TranscriptWordTiming[] = [];
  let current: TranscriptWordTiming | null = null;

  for (const token of tokens) {
    const rawText = token.text ?? '';
    const text = normalizeWhisperWordText(rawText);
    if (!text || isSpecialWhisperToken(text)) {
      continue;
    }

    const startSeconds = secondsFromMixedTiming(token.offsets?.from, token.timestamps?.from, token.t0);
    const endSeconds = secondsFromMixedTiming(token.offsets?.to, token.timestamps?.to, token.t1);
    const startsNewWord = current === null || /^\s/.test(rawText);

    if (startsNewWord) {
      if (current && isUsableWordTiming(current)) {
        wordTimings.push(current);
      }
      current = { text, startSeconds, endSeconds };
      continue;
    }

    current = current
      ? { text: `${current.text}${text}`, startSeconds: current.startSeconds, endSeconds }
      : { text, startSeconds, endSeconds };
  }

  if (current && isUsableWordTiming(current)) {
    wordTimings.push(current);
  }

  return wordTimings;
}

function isUsableWordTiming(word: TranscriptWordTiming): boolean {
  return word.text.trim().length > 0 && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) && word.endSeconds > word.startSeconds;
}

function isSpecialWhisperToken(text: string): boolean {
  return /^(\[.*\]|<\|.*\|>|_{2,}|BEG|END|TT_\d+)$/i.test(text.trim());
}

function normalizeWhisperWordText(value: string): string {
  return value
    .trim()
    .replace(/TT_\d+$/i, '')
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

function secondsFromMixedTiming(
  offsetMilliseconds: number | undefined,
  timestamp: string | undefined,
  seconds: number | undefined
): number {
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }

  return offsetToSeconds(offsetMilliseconds, timestamp);
}

function offsetToSeconds(offsetMilliseconds: number | undefined, timestamp: string | undefined): number {
  if (typeof offsetMilliseconds === 'number') {
    return Math.max(0, offsetMilliseconds / 1000);
  }

  if (!timestamp) {
    return 0;
  }

  const match = /^(?<hours>\d{2}):(?<minutes>\d{2}):(?<seconds>\d{2})[,.](?<milliseconds>\d{3})$/.exec(timestamp);
  if (!match?.groups) {
    return 0;
  }

  return (
    Number(match.groups.hours) * 3600 +
    Number(match.groups.minutes) * 60 +
    Number(match.groups.seconds) +
    Number(match.groups.milliseconds) / 1000
  );
}
