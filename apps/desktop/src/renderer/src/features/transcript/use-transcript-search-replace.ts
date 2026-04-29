import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TranscriptSegment } from '@voxmire/contracts';
import { countTranscriptMatches, escapeRegExp, findTranscriptMatchIndexes } from '../../lib/transcript-search';
import { replaceSegmentInTranscriptSnapshot } from '../../lib/transcript-history';

type UseTranscriptSearchReplaceOptions = {
  onSeekSegment: (segment: TranscriptSegment) => void;
  rememberTranscriptHistory: (label: string, before: TranscriptSegment[], after: TranscriptSegment[]) => void;
  segments: TranscriptSegment[];
  updateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
};

export type TranscriptSearchReplaceController = {
  activeFindIndex: number;
  activeFindSegment: TranscriptSegment | null;
  findMatchCount: number;
  findMatchIndexesCount: number;
  findPanelOpen: boolean;
  findQuery: string;
  jumpToFindMatch: (direction: 'previous' | 'next') => void;
  replaceAllTranscriptMatches: () => Promise<void>;
  replacePanelOpen: boolean;
  replaceQuery: string;
  replacingText: boolean;
  setFindPanelOpen: (open: boolean) => void;
  setFindQuery: (query: string) => void;
  setReplacePanelOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  setReplaceQuery: (query: string) => void;
  toggleFindPanel: () => void;
};

export function useTranscriptSearchReplace({
  onSeekSegment,
  rememberTranscriptHistory,
  segments,
  updateSegment
}: UseTranscriptSearchReplaceOptions): TranscriptSearchReplaceController {
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [replacingText, setReplacingText] = useState(false);
  const findMatchCount = useMemo(() => countTranscriptMatches(segments, findQuery), [findQuery, segments]);
  const findMatchIndexes = useMemo(() => findTranscriptMatchIndexes(segments, findQuery), [findQuery, segments]);
  const activeFindSegment = findMatchIndexes.length > 0 ? segments[findMatchIndexes[Math.min(activeFindIndex, findMatchIndexes.length - 1)] ?? -1] ?? null : null;

  const jumpToFindMatch = useCallback((direction: 'previous' | 'next'): void => {
    if (findMatchIndexes.length === 0) {
      return;
    }

    const nextIndex =
      direction === 'next'
        ? (activeFindIndex + 1) % findMatchIndexes.length
        : (activeFindIndex - 1 + findMatchIndexes.length) % findMatchIndexes.length;
    const segment = segments[findMatchIndexes[nextIndex] ?? -1];
    setActiveFindIndex(nextIndex);
    if (segment) {
      onSeekSegment(segment);
    }
  }, [activeFindIndex, findMatchIndexes, onSeekSegment, segments]);

  const toggleFindPanel = useCallback((): void => {
    if (findPanelOpen) {
      setReplacePanelOpen(false);
    }

    setFindPanelOpen((open) => !open);
  }, [findPanelOpen]);

  const replaceAllTranscriptMatches = useCallback(async (): Promise<void> => {
    const query = findQuery.trim();
    if (!query || replacingText) {
      return;
    }

    const matcher = new RegExp(escapeRegExp(query), 'gi');
    const matchingSegments = segments.filter((segment) => {
      matcher.lastIndex = 0;
      return matcher.test(segment.text);
    });
    if (matchingSegments.length === 0) {
      return;
    }

    const before = segments;
    let nextSegments = segments;
    setReplacingText(true);
    try {
      for (const segment of matchingSegments) {
        const currentSegment = nextSegments.find((candidate) => candidate.id === segment.id) ?? segment;
        matcher.lastIndex = 0;
        const nextText = currentSegment.text.replace(matcher, replaceQuery);
        if (nextText !== currentSegment.text) {
          const updated = await updateSegment(currentSegment.id, nextText);
          if (updated) {
            nextSegments = replaceSegmentInTranscriptSnapshot(nextSegments, updated);
          }
        }
      }

      rememberTranscriptHistory('Replace all', before, nextSegments);
    } finally {
      setReplacingText(false);
    }
  }, [findQuery, rememberTranscriptHistory, replaceQuery, replacingText, segments, updateSegment]);

  useEffect(() => {
    setActiveFindIndex(0);
  }, [findQuery]);

  return {
    activeFindIndex,
    activeFindSegment,
    findMatchCount,
    findMatchIndexesCount: findMatchIndexes.length,
    findPanelOpen,
    findQuery,
    jumpToFindMatch,
    replaceAllTranscriptMatches,
    replacePanelOpen,
    replaceQuery,
    replacingText,
    setFindPanelOpen,
    setFindQuery,
    setReplacePanelOpen,
    setReplaceQuery,
    toggleFindPanel
  };
}